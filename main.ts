import {
	App,
	SuggestModal,
	Plugin,
	PluginSettingTab, Setting
} from 'obsidian';

import OpenAI from 'openai';


interface TextMoverPluginSettings {
	mySetting: string;
}

interface TextMoverPluginSettings {
	mySetting: string;
	useLLM: boolean;
	openAIapiKey: string;
	modelName: string;
	maxTokens: number;
}

const DEFAULT_SETTINGS: TextMoverPluginSettings = {
	mySetting: "default",
	useLLM: false,
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
		console.log("inside constructor");
		this.headings = headings;
		// console.log(this.headings);
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

	async onload() {
		await this.loadSettings();
		await this.build_api()
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				menu.addItem((item) => {
					item
						.setTitle("Move text to heading")
						.setIcon("document")
						.onClick(async () => {
							let selection = editor.getSelection();
							const cursorposition = editor.getCursor()

							if (selection == "") {
								// get clicked text
								selection = editor.getLine(cursorposition.line)
							}
							console.log(selection)
							// TODO: get cursor position

							const file = this.app.workspace.getActiveFile()
							// get headings from file
							if (!file) {
								return
							}
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
							if (this.settings.useLLM) {
								const heading_str = headings.map(heading => heading.heading).join(", ")
								const prompt = "For the text below, suggest top3 classes from one of the following classes(no fluff, no explaination, no numbering just the classes): \n" +
									"```\n " +
									"classes:" + heading_str + "\n" +
									"text: " + selection
								// api post call to openai
								const chatCompletion = await this.llm_client.chat.completions.create({
									messages: [{role: 'user', content: prompt}],
									model: this.settings.modelName,
								});

								// get chosen classes
								let chosen_classses: string[] = [];
								const llm_response = chatCompletion.choices[0].message.content
								// alert notice the class
								// split classes by ", " or newline
								if (llm_response == null || llm_response.length==0){
									chosen_classses = []
								}
								else if (llm_response.includes("\n")) {
									chosen_classses = llm_response.split("\n")
								} else if (llm_response.includes(", ")) {
									chosen_classses = llm_response.split(", ")
								} else if (llm_response.length > 0) {
									chosen_classses = llm_response.split(", ")
								}
								// strip non alphabetic characters
								chosen_classses = chosen_classses.map((item: string) => item.trim().replace(/[^a-zA-Z /]/g, ''))
								console.log(chosen_classses);
								//sort heading by chosen_classes
								headings.sort((a, b) => {
									return -(chosen_classses.indexOf(a.heading) - chosen_classses.indexOf(b.heading));
								})
							}
							const hmodal = new HeadingSuggestionModal(this.app, headings, (result) => {
								const cursorposition = editor.getCursor()
								// concatenate all headings with ,
								// @ts-ignore
								const targetPosition = {"line": result.position.end.line, "ch": result.position.end.ch}
								// insert selection under heading								  
								editor.replaceRange(`\n${selection}`, targetPosition)

								const start = {"line": cursorposition.line, "ch": 0}
								const end = {"line": cursorposition.line, "ch": selection.length + 1}
								editor.replaceRange("", start, end)
							});

							hmodal.open()
						});

				})

			}))

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				menu.addItem((item) => {
					item
						.setTitle("Auto classify")
						.setIcon("document")
						.onClick(async () => {

							const file = this.app.workspace.getActiveFile()
							// get headings from file
							if (!file) {
								return
							}
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
								return
							}
							// @ts-ignore
							const lastLine: number = headings.last().position.end.line
							// generate difference array
							const line_heading_map: number[] = Array.apply(0, Array(lastLine)).map(Number.prototype.valueOf, 0)

							console.log(line_heading_map)

							// console.log(lastLine)
							for (let i = 1, prev_heading = 0; i < headings.length; i++) {
								// @ts-ignore
								line_heading_map[headings[i].position.end.line] = headings[i].position.end.line - prev_heading
								// @ts-ignore
								prev_heading = headings[i].position.end.line
							}
							console.log(line_heading_map)
							// generate actual array from difference array
							const actual_line_heading_map: number[] = []
							for (let i = 0; i < line_heading_map.length; i++) {
								if (i == 0) {
									actual_line_heading_map[i] = line_heading_map[i]
								} else {
									actual_line_heading_map[i] = actual_line_heading_map[i - 1] + line_heading_map[i]
								}
							}

							console.log(actual_line_heading_map)
							let training_instances: object[] = []

							actual_line_heading_map.map((ele, idx: number) => {
								let input = editor.getLine(idx)
								// replace numerical prefixes from input with ""
								input = input.replace(/\d+\./g, "")
								input = input.replace(/#+ /g, "")

								// remove trailing whitespace
								input = input.trim()
								let target = editor.getLine(ele)
								// replace preceeding # and spaces with ""

								target = target.replace(/#+ /g, "")
								training_instances.push({
									"input": input,
									"target": target
								})
							})
							// filter training examples with empty input or target
							// @ts-ignore
							training_instances = training_instances.filter(ele => ele.input != "" && ele.target != "" && ele.input != ele.target)
							console.log(training_instances)
							// for (let i = 0; i < actual_line_heading_map.length; i++) {
							// 	const line_text = editor.getLine(i)
							//
							// 	if (line_text.trim() == "") {
							// 		continue;
							// 	}
							// 	console.log(line_text)
							// 	const heading_line = actual_line_heading_map[i]
							// 	console.log(editor.getLine(heading_line))
							// }


							// total lines

						});

				})

			}))

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
		console.log("build api here.")
		this.llm_client = new OpenAI({
			apiKey: this.settings.openAIapiKey, // This is the default and can be omitted
			dangerouslyAllowBrowser: true,
		});
		console.log(this.llm_client)

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
		containerEl.createEl("h2", {text: "Settings for my TextMover plugin."});
		const api_key_setting = new Setting(containerEl).setName("OpenAI API Key").addText((text) =>
			text
				.setPlaceholder("Enter OpenAI key here")
				.setValue(this.plugin.settings.openAIapiKey)
				.onChange(async (value) => {
					this.plugin.settings.openAIapiKey = value;
					await this.plugin.saveSettings();
					this.plugin.build_api();
				}),
		);
		const model_name_setting = new Setting(containerEl)
			.setName("Model Name")
			.setDesc("Select your model")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"gpt-3.5-turbo": "gpt-3.5-turbo",
						"gpt-4": "gpt-4",
					})
					.setValue(this.plugin.settings.modelName)
					.onChange(async (value) => {
						this.plugin.settings.modelName = value;
						await this.plugin.saveSettings();
						this.plugin.build_api();
					}),
			);

		new Setting(containerEl)
			.setName("Use LLM")
			.setDesc("Select to get smart classification using LLM")
			.addToggle((toogle) => {
				toogle
					.setValue(this.plugin.settings.useLLM)
					.onChange(async (value) => {
						this.plugin.settings.useLLM = value;
						await this.plugin.saveSettings();
						this.plugin.build_api();
						api_key_setting.setDisabled(!value);
						model_name_setting.setDisabled(!value);
					});
			});
	}
}
