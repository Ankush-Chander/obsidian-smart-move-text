import {
	App,
	SuggestModal,
	Plugin,
	PluginSettingTab, Setting, Editor, Notice
} from 'obsidian';

import OpenAI from 'openai';

// Load wink-nlp package.
import WinkNLP from 'wink-nlp';
import {ItemToken} from 'wink-nlp';
// Load english language model.
import model from 'wink-eng-lite-web-model';
// Instantiate winkNLP.
const winkNLP = WinkNLP;
const nlp = winkNLP(model);
// Obtain "its" helper to extract item properties.
const its = nlp.its;

// ===============================================================

function NaiveBayesianClassifier() {
	if (!(this instanceof NaiveBayesianClassifier)) {
		// @ts-ignore
		return new NaiveBayesianClassifier()
	}
	this.docs = [];
	// set
	this.classes = new Set([]);
	this.loglikelihood = {};
	this.logprior = {};
	this.vocabulary = new Set([]);
	return this;
}

NaiveBayesianClassifier.prototype.tokenize = function (text: string) {
	// let words = text.split(/[^A-Za-z/ ]/)
	// words = words.filter((w) => w.length > 0)
	const doc = nlp.readDoc(text)
	// console.log(doc.tokens().out(its.type))

	let words = doc.tokens().filter((t: ItemToken) => t.out(its.type) === 'word').out(its.normal);
	// handle url

	const urls = doc.tokens().filter((t: ItemToken) => t.out(its.type) === 'url').out(its.normal);
	const url_stop_list = ["http", "https", "www", "com", "org", "co", "net", "gov", "edu", "uk", "au", "ca", "us", "in", "io", "info", "biz", "name", "blog", "app", "appspot", "appspot.com", "code"]
	urls.forEach((url: string) => {
		let url_words = url.split(/[^A-Za-z0-9 ]/)
		url_words = url_words.filter((w) => w.length > 0 && !url_stop_list.includes(w))
		words = words.concat(url_words)
	})
	return words
}

NaiveBayesianClassifier.prototype.addDocument = function (doc: string | string[], target: string) {
	// add target to classes if target not in classes
	if (!this.classes.has(target)) {
		this.classes.add(target)
	}

	let words = doc
	if (typeof (doc) == "string") {
		words = this.tokenize(doc)
	}
	if (words.length == 0) {
		// console.log("empty doc " + target + " " + doc)
		return
	}

	// add doc to docs
	this.docs.push({
		value: words,
		label: target
	})
}

NaiveBayesianClassifier.prototype.train = function () {

	const classprior = {}

	// classwise words
	const bigDoc: { [key: string]: string[] } = {};


	this.docs.forEach((doc: { label: string | number; value: string[]; }) => {
		// count documents per class
		// @ts-ignore
		classprior[doc.label] = classprior[doc.label] || 0
		// @ts-ignore
		classprior[doc.label] += 1

		// collect words into class
		//@ts-ignore
		bigDoc[doc.label] = bigDoc[doc.label] || []
		// @ts-ignore
		bigDoc[doc.label] = bigDoc[doc.label].concat(doc.value)

		// collect words into vocabulary
		doc.value.forEach(this.vocabulary.add, this.vocabulary);
	})

	// normalize
	for (const [class_, value] of Object.entries(classprior)) {
		// @ts-ignore
		this.logprior[class_] = Math.log(value / this.docs.length)
	}

	// console.log(this.logprior)
	// loop over vocabulary
	for (const [class_] of Object.entries(classprior)) {
		const class_counter: { [key: string]: number } = {}
		bigDoc[class_].forEach((item: string) => {
			class_counter[item] = (class_counter[item] || 0) + 1
		});
		let denominator = 0
		// console.log(class_counter)
		this.vocabulary.forEach((word: string) => {
			denominator += (class_counter[word] || 0) + 1
		})
		// @ts-ignore

		for (const word of this.vocabulary) {
			this.loglikelihood[word] = this.loglikelihood[word] || {}
			const count_w_c = class_counter[word] || 0
			// @ts-ignore
			this.loglikelihood[word][class_] = Math.log((count_w_c + 1) / denominator);
		}
	}
	// console.log("training.")
}

NaiveBayesianClassifier.prototype.classify = function (doc: string | string[]) {
	const class_scores = {}
	if (typeof (doc) == "string") {
		doc = this.tokenize(doc)
	}
	for (const [class_, value] of Object.entries(this.logprior)) {
		// @ts-ignore
		class_scores[class_] = value
		for (const word of doc) {
			if (this.vocabulary.has(word)) {
				// @ts-ignore
				class_scores[class_] += this.loglikelihood[word][class_]
			}
		}
	}
	const classes: [string, number][] = Object.entries(class_scores)
	classes.sort((a: [string, number], b: [string, number]) => b[1] - a[1])
	const sorted_classes = classes.map((item) => item[0])
	return sorted_classes
}

NaiveBayesianClassifier.prototype.addDocuments = function (texts: string[], target: string) {
	for (const text in texts) {
		this.docs.push({
			text: text,
			target: target
		})
	}

}


// let nbc = NaiveBayesianClassifier()

// ===============================================================
interface TextMoverPluginSettings {
	mySetting: string;
}

interface TextMoverPluginSettings {
	mySetting: string;
	classifier: string;
	openAIapiKey: string;
	modelName: string;
	maxTokens: number;
}

const DEFAULT_SETTINGS: TextMoverPluginSettings = {
	mySetting: "default",
	classifier: "",
	openAIapiKey: "",
	modelName: "gpt-3.5-turbo",
	maxTokens: 20,

};


interface Heading {
	heading: string;
	level: number;
	position: object;
}


export class HeadingSuggestionModal extends SuggestModal<Heading> {
	// Returns all available suggestions.
	headings: Heading[];
	result: object
	onSubmit: (result: object) => void;

	constructor(app: App, headings: Heading[], onSubmit: (result: object) => void) {
		super(app);
		this.headings = headings;
		this.onSubmit = onSubmit;

	}

	onOpen() {
		// console.log("inside onOpen");
		super.onOpen();
	}

	getSuggestions(query: string): Heading[] {
		return this.headings.filter((item) =>
			item.heading.toLowerCase().includes(query.toLowerCase())
		);
	}

	// Renders each suggestion item.
	renderSuggestion(heading: Heading, el: HTMLElement) {
		el.createEl("div", {text: heading.heading});
	}

	// Perform action on the selected suggestion.
	onChooseSuggestion(heading: Heading, evt: MouseEvent | KeyboardEvent) {
		this.onSubmit(heading);
	}
}


export default class TextMoverPlugin extends Plugin {
	settings: TextMoverPluginSettings;
	llm_client: OpenAI;

	get_file_headings(file: any) {
		const filecache = this.app.metadataCache.getFileCache(file)
		let headings: Heading[] = [];
		if (filecache && filecache.headings) {
			headings = filecache.headings.map(headingCache => {
				return {
					heading: headingCache.heading,
					level: headingCache.level,
					position: headingCache.position
				};
			});
		}
		// sort headings alphabetically
		headings.sort((a, b) => a.heading.localeCompare(b.heading))
		return headings
	}

	process_headings_from_llm_response(llm_response: string | null) {
		// alert notice the class
		// split classes by ", " or newline
		let chosen_classses: string[] = []
		if (llm_response == null || llm_response.length == 0) {
			chosen_classses = []
		} else if (llm_response.includes("\n")) {
			chosen_classses = llm_response.split("\n")
		} else if (llm_response.includes(", ")) {
			chosen_classses = llm_response.split(", ")
		} else if (llm_response.length > 0) {
			chosen_classses = llm_response.split(", ")
		}
		// strip non alphabetic characters
		chosen_classses = chosen_classses.map((item: string) => item.trim().replace(/[^a-zA-Z /]/g, '').trim())
		console.log(chosen_classses);
		return chosen_classses
	}

	async sort_headings_via_llm(headings: Heading[], selection = "", editor: Editor, callback: {
		(): void;
		(arg0: Heading[], arg1: string, arg2: Editor): void;
	}) {
		if (!this.settings.openAIapiKey) {
			new Notice("OpenAI API key not set in the plugin settings. Returning default headings.")
			callback(headings, selection, editor)
			return
		}
		const heading_str = headings.map(heading => heading.heading).join(", ")
		const prompt = "For the text below, suggest top3 classes from one of the following classes(no fluff, no explaination, no numbering just the classes): \n" +
			"```\n " +
			"classes:" + heading_str + "\n" +
			"text: " + selection
		// api post call to openai
		await this.llm_client.chat.completions.create({
			messages: [{role: 'user', content: prompt}],
			model: this.settings.modelName,
		}).then(
			(response) => {
				const llm_response = response.choices[0].message.content
				const chosen_classses = this.process_headings_from_llm_response(llm_response)
				headings.sort((a, b) => {
					return -(chosen_classses.indexOf(a.heading) - chosen_classses.indexOf(b.heading));
				})
				// return headings
				callback(headings, selection, editor)
			},
			(error) => {
				// console.log("c2")
				new Notice("Error: " + error.message)
				callback(headings, selection, editor)
			}
		);
	}

	async sort_headings_via_bayesian(headings: Heading[], training_instances: object[], selection = "") {
		const nbc = NaiveBayesianClassifier();
		// loop over training instances
		for (const instance of training_instances) {
			// @ts-ignore
			nbc.addDocument(instance.input, instance.label)
		}
		nbc.train()
		const sorted_classes = nbc.classify(selection)
		console.log(sorted_classes);
		// add missing headings to sorted classes
		headings.forEach((heading) => {
			if (!sorted_classes.includes(heading.heading)) {
				sorted_classes.push(heading.heading)
			}
		})

		headings.sort((a, b) => {
			return (sorted_classes.indexOf(a.heading) - sorted_classes.indexOf(b.heading))
		})
		return headings
	}

	get_action_line(editor: Editor) {
		const selection_detail = editor.listSelections()
		// console.log(selection_detail)
		let line_no = null
		selection_detail.forEach(es => {
			// loop through selected lines
			const min = Math.min(es.anchor.line, es.head.line), max = Math.max(es.anchor.line, es.head.line)
			for (let i = min; i <= max; i++) {
				const line_text = editor.getLine(i).trim()
				if (line_text == "" || line_text.startsWith("#")) {
					// skip empty lines and headings
					// console.log("skipping line: " + line_text)
					continue
				} else {
					line_no = i
					break
				}
			}
		})
		return line_no
	}

	modal_submit_callback(result: object, editor: Editor) {
		// choose first valid line as actionable line
		// idle behaviour, act on all lines
		const action_line = this.get_action_line(editor)
		if (action_line == null) {
			return
		}
		const selection = editor.getLine(action_line)
		// concatenate all headings with ,
		// @ts-ignore
		const source_start = {"line": action_line, "ch": 0}
		const source_end = {"line": action_line, "ch": selection.length}
		// @ts-ignore
		const targetPosition = {"line": result.position.end.line + 1, "ch": 0}
		if (source_start.line > targetPosition.line) {
			editor.replaceRange("", source_start, source_end)
			editor.replaceRange(`${selection}\n`, targetPosition)
		} else {
			editor.replaceRange(`${selection}\n`, targetPosition)
			editor.replaceRange("", source_start, source_end)
		}
		// @ts-ignore
		new Notice("Moved text to heading: " + result.heading)

	}

	getTrainingInstancesFromFile(editor: Editor, file: any) {
		const filecache = this.app.metadataCache.getFileCache(file)
		let headings: Heading[] = [];
		if (filecache && filecache.headings) {
			headings = filecache.headings.map(headingCache => {
				return {
					heading: headingCache.heading,
					level: headingCache.level,
					position: headingCache.position
				};
			});
		}
		if (typeof (headings) == "undefined" || headings == null || headings.length == 0) {
			return []
		}
		// @ts-ignore
		const lastLine: number = headings.last().position.end.line
		// generate difference array
		const line_heading_map: number[] = Array.apply(0, Array(lastLine)).map(Number.prototype.valueOf, 0)

		// console.log(lastLine)
		for (let i = 1, prev_heading = 0; i < headings.length; i++) {
			// @ts-ignore
			line_heading_map[headings[i].position.end.line] = headings[i].position.end.line - prev_heading
			// @ts-ignore
			prev_heading = headings[i].position.end.line
		}
		// generate actual array from difference array
		const actual_line_heading_map: number[] = []
		for (let i = 0; i < line_heading_map.length; i++) {
			if (i == 0) {
				actual_line_heading_map[i] = line_heading_map[i]
			} else {
				actual_line_heading_map[i] = actual_line_heading_map[i - 1] + line_heading_map[i]
			}
		}

		const training_instances: object[] = []

		actual_line_heading_map.map((ele, idx: number) => {
			let input = editor.getLine(idx)
			// replace numerical prefixes from input with ""
			input = input.replace(/\d+\./g, "")
			input = input.replace(/#+ /g, "")

			// remove trailing whitespace
			input = input.trim()
			let label = editor.getLine(ele)
			// replace preceeding # and spaces with ""

			label = label.replace(/#+ /g, "")
			if (input != "" && label != "" && input != label) {
				training_instances.push({
					"input": input,
					"label": label
				})
			}
		})
		// filter training examples with empty input or target
		// @ts-ignore
		// training_instances = training_instances.filter(ele => ele.input != "" && ele.target != "")
		// console.log(training_instances)
		return training_instances
	}

	async editorcallback() {


		const editor = this.app.workspace.activeEditor?.editor
		if (!editor) {
			return
		}

		const action_line = this.get_action_line(editor)
		if (action_line == null) {
			return
		}

		const selection = editor.getLine(action_line)

		const file = this.app.workspace.getActiveFile()
		// get headings from file
		if (!file) {
			return
		}

		let headings = this.get_file_headings(file)

		// sort headings via LLM call
		if (this.settings.classifier == "llm") {
			await this.sort_headings_via_llm(headings, selection, editor, () => {
				const hmodal = new HeadingSuggestionModal(this.app, headings, (result) => {
						this.modal_submit_callback(result, editor)
					}
				);
				hmodal.setPlaceholder(selection);
				hmodal.open()
			})
			return
		} else if (this.settings.classifier == "nbc") {
			const training_instances = this.getTrainingInstancesFromFile(editor, file)
			headings = await this.sort_headings_via_bayesian(headings, training_instances, selection)
		}

		const hmodal = new HeadingSuggestionModal(this.app, headings, (result) => {
				this.modal_submit_callback(result, editor)
			}
		);
		hmodal.setPlaceholder(selection);
		hmodal.open()
	}

	async onload() {
		await this.loadSettings();
		await this.build_api()
		this.addCommand(
			{
				"id": "move-text-to-heading",
				"name": "Move text to heading",
				editorCallback: (editor: Editor) => {
					// get activeEditor
					this.editorcallback()
				}
			}
		)
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				menu.addItem((item) => {
					item
						.setTitle("Move text to heading")
						.setIcon("document")
						.onClick(async () => {
							this.editorcallback();
						});

				})

			}))


		// for debugging
		// This creates an icon in the left ribbon.
		// this.addRibbonIcon('dice', 'Log training examples', (evt: MouseEvent) => {
		// 	const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor
		// 	if (editor == null) {
		// 		return
		// 	}
		// 	const file = this.app.workspace.getActiveFile()
		// 	// get headings from file
		// 	if (!file) {
		// 		return
		// 	}
		//
		// 	let training_instances = this.getTrainingInstancesFromFile(editor, file)
		// 	// console.log(training_instances)
		// });
		//

		this.addSettingTab(new TextMoverSettingTab(this.app, this));

	}


	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async build_api() {
		// console.log("build api here.")
		if (this.settings.classifier == "llm") {
			this.llm_client = new OpenAI({
				apiKey: this.settings.openAIapiKey, // This is the default and can be omitted
				dangerouslyAllowBrowser: true,
			});
			// console.log(this.llm_client)
		}


	}
}


class TextMoverSettingTab extends PluginSettingTab {
	plugin: TextMoverPlugin;

	constructor(app: App, plugin: TextMoverPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Classifier")
			.setDesc("Select classifier to get smart suggestions")
			.addDropdown((dropdown) => dropdown.addOptions({
				"": "No classifier",
				"nbc": "Bayesian",
				"llm": "LLM",
			}).setValue(this.plugin.settings.classifier)
				.onChange(async (value) => {
					this.plugin.settings.classifier = value;
					await this.plugin.saveSettings();
					if (value == "llm") {
						this.plugin.build_api();
					}
					api_key_setting.setDisabled(!(value == "llm"));
					model_name_setting.setDisabled(!(value == "llm"));


				}));

		new Setting(containerEl).setName('LLM').setHeading();

		const api_key_setting = new Setting(containerEl).setName("OpenAI API Key").addText((text) =>
			text
				.setPlaceholder("Enter OpenAI key here")
				.setValue(this.plugin.settings.openAIapiKey)
				.setDisabled(this.plugin.settings.classifier != "llm")
				.onChange(async (value) => {
					this.plugin.settings.openAIapiKey = value;
					await this.plugin.saveSettings();
					if (this.plugin.settings.classifier == "llm") {
						this.plugin.build_api();
					}
				}),
		);

		const model_name_setting = new Setting(containerEl)
			.setName("Model name")
			.setDesc("Select your model")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"gpt-3.5-turbo": "gpt-3.5-turbo",
						"gpt-4": "gpt-4",
					})
					.setValue(this.plugin.settings.modelName)
					.setDisabled(this.plugin.settings.classifier != "llm")
					.onChange(async (value) => {
						this.plugin.settings.modelName = value;
						await this.plugin.saveSettings();
						if (this.plugin.settings.classifier == "llm") {
							this.plugin.build_api();
						}
					})
			);


	}
}
