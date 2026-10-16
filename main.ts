import {
	App,
	Editor,
	EditorPosition,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	requestUrl,
} from "obsidian";

/** The slice of CodeMirror's EditorView we use, exposed as `editor.cm`. */
interface CodeMirrorView {
	coordsAtPos(pos: number): { left: number; bottom: number } | null;
}
import {
	buildEmbedUrl,
	buildIframeHtml,
	escapeLinkText,
	parseBlock,
	parseYouTube,
	pastedYouTubeUrl,
} from "./parse";

interface YouTubeEmbedSettings {
	privacyMode: boolean;
	maxWidth: string;
	shortsMaxWidth: string;
	pasteMenu: boolean;
}

const DEFAULT_SETTINGS: YouTubeEmbedSettings = {
	privacyMode: true,
	maxWidth: "100%",
	shortsMaxWidth: "360px",
	pasteMenu: true,
};

export default class YouTubeEmbedPlugin extends Plugin {
	settings: YouTubeEmbedSettings;

	async onload() {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor("youtube", (source, el) => this.renderBlock(source, el));

		this.registerEvent(
			this.app.workspace.on("editor-paste", (evt, editor) => this.onPaste(evt, editor)),
		);

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

	/**
	 * Notion-style paste: a lone YouTube URL is pasted as plain text first, then a
	 * menu at the cursor offers to turn it into an embed, iframe, or titled link.
	 */
	onPaste(evt: ClipboardEvent, editor: Editor) {
		if (!this.settings.pasteMenu || evt.defaultPrevented) return;
		if (editor.somethingSelected()) return;
		const text = evt.clipboardData?.getData("text/plain") ?? "";
		const video = pastedYouTubeUrl(text);
		if (!video) return;

		evt.preventDefault();
		const url = text.trim();
		const from = editor.getCursor("from");
		editor.replaceSelection(url);
		const to = editor.getCursor("to");

		const cm = (editor as unknown as { cm?: CodeMirrorView }).cm;
		const coords = cm?.coordsAtPos(editor.posToOffset(to));
		if (!coords) return;

		const menu = new Menu();
		menu.setUseNativeMenu(false);
		menu.addItem((i) => i.setTitle("Dismiss").setIcon("x").onClick(() => menu.hide()));
		menu.addItem((i) =>
			i
				.setTitle(video.isShort ? "Embed Short" : "Embed video")
				.setIcon("play")
				.onClick(() => this.replacePasted(editor, from, to, url, this.blockText(editor, from, to, url))),
		);
		menu.addItem((i) =>
			i
				.setTitle("Embed as HTML iframe")
				.setIcon("code")
				.onClick(() =>
					this.replacePasted(editor, from, to, url, buildIframeHtml(video, this.settings.privacyMode)),
				),
		);
		menu.addItem((i) =>
			i
				.setTitle("Link with title")
				.setIcon("link")
				.onClick(() => this.pasteTitledLink(editor, from, to, url)),
		);
		// Like Notion: typing after the paste closes the menu and the keys reach the editor.
		const win = activeWindow;
		const dismissOnType = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") menu.hide();
		};
		win.addEventListener("keydown", dismissOnType, true);
		menu.onHide(() => win.removeEventListener("keydown", dismissOnType, true));

		menu.showAtPosition({ x: coords.left, y: coords.bottom + 4 }, win.document);
	}

	/** Wrap the code block in newlines when the URL was pasted mid-line. */
	blockText(editor: Editor, from: EditorPosition, to: EditorPosition, url: string): string {
		const before = editor.getLine(from.line).slice(0, from.ch);
		const after = editor.getLine(to.line).slice(to.ch);
		return `${before.trim() ? "\n" : ""}\`\`\`youtube\n${url}\n\`\`\`${after.trim() ? "\n" : ""}`;
	}

	/** Swap the pasted URL for `replacement`, unless the user already edited it. */
	replacePasted(editor: Editor, from: EditorPosition, to: EditorPosition, url: string, replacement: string): boolean {
		if (editor.getRange(from, to) !== url) {
			new Notice("The pasted link changed, so it was left as is.");
			return false;
		}
		editor.replaceRange(replacement, from, to);
		editor.setCursor(editor.offsetToPos(editor.posToOffset(from) + replacement.length));
		return true;
	}

	async pasteTitledLink(editor: Editor, from: EditorPosition, to: EditorPosition, url: string) {
		try {
			const res = await requestUrl({
				url: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
			});
			const title = (res.json as { title?: string }).title;
			if (!title) throw new Error("no title");
			this.replacePasted(editor, from, to, url, `[${escapeLinkText(title)}](${url})`);
		} catch {
			new Notice("Could not fetch the video title.");
		}
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
			.setName("Show menu on paste")
			.setDesc("When you paste a YouTube link, offer to embed it, paste an iframe, or add its title.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.pasteMenu).onChange(async (value) => {
					this.plugin.settings.pasteMenu = value;
					await this.plugin.saveSettings();
				}),
			);

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
