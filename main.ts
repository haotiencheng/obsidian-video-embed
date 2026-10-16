import { App, Editor, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { buildEmbedUrl, parseBlock, parseYouTube } from "./parse";

interface YouTubeEmbedSettings {
	privacyMode: boolean;
	maxWidth: string;
	shortsMaxWidth: string;
}

const DEFAULT_SETTINGS: YouTubeEmbedSettings = {
	privacyMode: true,
	maxWidth: "100%",
	shortsMaxWidth: "360px",
};

export default class YouTubeEmbedPlugin extends Plugin {
	settings: YouTubeEmbedSettings;

	async onload() {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor("youtube", (source, el) => this.renderBlock(source, el));

		this.addCommand({
			id: "insert-youtube-embed",
			name: "Insert YouTube embed",
			editorCallback: (editor: Editor) => this.insertEmbed(editor),
		});

		this.addSettingTab(new YouTubeEmbedSettingTab(this.app, this));
	}

	renderBlock(source: string, el: HTMLElement) {
		const opts = parseBlock(source);
		const video = opts ? parseYouTube(opts.url) : null;
		if (!opts || !video) {
			el.createDiv({
				cls: "youtube-embed-error",
				text: "YouTube embed: no valid YouTube URL or video id found.",
			});
			return;
		}

		const vertical = opts.vertical ?? video.isShort;
		const figure = el.createEl("figure", {
			cls: ["youtube-embed", vertical ? "is-vertical" : "is-horizontal"],
		});
		figure.style.setProperty(
			"--youtube-embed-max-width",
			opts.width ?? (vertical ? this.settings.shortsMaxWidth : this.settings.maxWidth),
		);

		const frame = figure.createDiv({ cls: "youtube-embed-frame" });
		frame.createEl("iframe", {
			attr: {
				src: buildEmbedUrl(video, {
					start: opts.start,
					end: opts.end,
					privacyMode: this.settings.privacyMode,
				}),
				title: opts.caption ?? "YouTube video",
				frameborder: "0",
				allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
				referrerpolicy: "strict-origin-when-cross-origin",
				allowfullscreen: "true",
				loading: "lazy",
			},
		});

		if (opts.caption) figure.createEl("figcaption", { text: opts.caption });
	}

	async insertEmbed(editor: Editor) {
		let url = "";
		try {
			const clip = (await navigator.clipboard.readText()).trim();
			if (parseYouTube(clip)) url = clip;
		} catch {
			// Clipboard access can be denied; fall back to an empty block.
		}

		const cursor = editor.getCursor();
		const prefix = cursor.ch === 0 ? "" : "\n";
		editor.replaceRange(`${prefix}\`\`\`youtube\n${url}\n\`\`\`\n`, cursor);
		if (!url) {
			editor.setCursor({ line: cursor.line + (prefix ? 2 : 1), ch: 0 });
			new Notice("No YouTube URL in clipboard. Paste one into the block.");
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class YouTubeEmbedSettingTab extends PluginSettingTab {
	plugin: YouTubeEmbedPlugin;

	constructor(app: App, plugin: YouTubeEmbedPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Privacy-enhanced mode")
			.setDesc("Load embeds from youtube-nocookie.com. Re-open notes to apply.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.privacyMode).onChange(async (value) => {
					this.plugin.settings.privacyMode = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Max width")
			.setDesc("CSS width cap for regular (16:9) videos, e.g. 100% or 640px.")
			.addText((t) =>
				t.setValue(this.plugin.settings.maxWidth).onChange(async (value) => {
					this.plugin.settings.maxWidth = value.trim() || DEFAULT_SETTINGS.maxWidth;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Shorts max width")
			.setDesc("CSS width cap for vertical (9:16) Shorts, e.g. 360px.")
			.addText((t) =>
				t.setValue(this.plugin.settings.shortsMaxWidth).onChange(async (value) => {
					this.plugin.settings.shortsMaxWidth = value.trim() || DEFAULT_SETTINGS.shortsMaxWidth;
					await this.plugin.saveSettings();
				}),
			);
	}
}
