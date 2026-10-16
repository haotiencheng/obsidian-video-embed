import {
	App,
	Editor,
	EditorPosition,
	MarkdownPostProcessorContext,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	requestUrl,
	setIcon,
} from "obsidian";
import { buildEmbedUrl, escapeLinkText, parseBlock, parseYouTube, pastedYouTubeUrl, setBlockWidth } from "./parse";
import { PastePrompt } from "./paste-prompt";

/** The slice of CodeMirror's EditorView we use, exposed as `editor.cm`. */
interface CodeMirrorView {
	coordsAtPos(pos: number): { left: number; top: number; bottom: number } | null;
}

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

const MIN_WIDTH = 200;

export default class YouTubeEmbedPlugin extends Plugin {
	settings: YouTubeEmbedSettings;
	private prompt: PastePrompt | null = null;

	async onload() {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor("youtube", (source, el, ctx) => this.renderBlock(source, el, ctx));

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

	onunload() {
		this.prompt?.close();
	}

	renderBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const opts = parseBlock(source);
		const video = opts ? parseYouTube(opts.url) : null;
		if (!opts || !video) {
			el.createDiv({
				cls: "youtube-embed-error",
				text: "YouTube embed: put a YouTube link on the first line of this block.",
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

		this.addResizeHandle(figure, el, ctx);
		this.addUnembedButton(figure, el, ctx, opts.url);

		if (opts.caption) figure.createEl("figcaption", { text: opts.caption });
	}

	/** Drag the right-edge handle to resize; double-click it to reset. Width is saved into the block. */
	addResizeHandle(figure: HTMLElement, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const handle = figure.createDiv({ cls: "youtube-embed-resize" });
		// CSS tooltip: shows instantly on hover, independent of Obsidian's delayed tooltips.
		handle.createSpan({ cls: "youtube-embed-tip", text: "Drag to resize, double-click to reset" });

		handle.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const win = figure.win;
			const startX = e.clientX;
			const startWidth = figure.getBoundingClientRect().width;
			const maxWidth = (el.parentElement ?? el).getBoundingClientRect().width;
			let width = startWidth;
			figure.addClass("is-resizing");

			const onMove = (ev: PointerEvent) => {
				width = Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth, startWidth + ev.clientX - startX)));
				figure.style.setProperty("--youtube-embed-max-width", `${width}px`);
			};
			const onUp = () => {
				win.removeEventListener("pointermove", onMove);
				win.removeEventListener("pointerup", onUp);
				win.removeEventListener("pointercancel", onUp);
				figure.removeClass("is-resizing");
				if (Math.abs(width - startWidth) >= 2) {
					void this.saveWidth(el, ctx, width >= maxWidth - 2 ? "100%" : `${width}px`);
				}
			};
			win.addEventListener("pointermove", onMove);
			win.addEventListener("pointerup", onUp);
			win.addEventListener("pointercancel", onUp);
		});

		handle.addEventListener("click", (e) => e.stopPropagation());
		handle.addEventListener("dblclick", (e) => {
			e.preventDefault();
			e.stopPropagation();
			void this.saveWidth(el, ctx, null);
		});
	}

	/** Small hover button that turns the whole block back into the plain URL. */
	addUnembedButton(figure: HTMLElement, el: HTMLElement, ctx: MarkdownPostProcessorContext, url: string) {
		const button = figure.createEl("button", {
			cls: "youtube-embed-unembed",
		});
		setIcon(button, "x");
		// Doubles as the button's accessible name.
		button.createSpan({ cls: "youtube-embed-tip", text: "Remove embed, keep the link" });
		// mousedown would otherwise put Live Preview into edit mode for the block.
		button.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		button.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			void this.editBlock(el, ctx, () => [url]);
		});
	}

	saveWidth(el: HTMLElement, ctx: MarkdownPostProcessorContext, width: string | null) {
		return this.editBlock(el, ctx, (lines) => [
			lines[0],
			...setBlockWidth(lines.slice(1, -1), width),
			lines[lines.length - 1],
		]);
	}

	/** Replace the block's lines (fences included) with `transform(lines)`. */
	async editBlock(el: HTMLElement, ctx: MarkdownPostProcessorContext, transform: (lines: string[]) => string[]) {
		const info = ctx.getSectionInfo(el);
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!info || !(file instanceof TFile)) return;
		const { lineStart, lineEnd } = info;

		// Prefer the open editor so the change is undoable; fall back to editing the file.
		const view = this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === file.path);

		if (view && view.getMode() === "source") {
			const editor = view.editor;
			const lines: string[] = [];
			for (let line = lineStart; line <= lineEnd; line++) lines.push(editor.getLine(line));
			editor.replaceRange(
				transform(lines).join("\n"),
				{ line: lineStart, ch: 0 },
				{ line: lineEnd, ch: editor.getLine(lineEnd).length },
			);
			return;
		}

		await this.app.vault.process(file, (text) => {
			const lines = text.split("\n");
			const block = lines.slice(lineStart, lineEnd + 1);
			lines.splice(lineStart, block.length, ...transform(block));
			return lines.join("\n");
		});
	}

	/**
	 * Notion-style paste: a lone YouTube URL is pasted as plain text first, then a
	 * card at the cursor offers to turn it into an embed or a titled link.
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

		this.prompt?.close();
		this.prompt = new PastePrompt(activeWindow, coords, [
			{
				icon: "play",
				title: video.isShort ? "Embed Short" : "Embed video",
				desc: "Watch it right inside the note.",
				run: () => this.replacePasted(editor, from, to, url, this.blockText(editor, from, to, url)),
			},
			{
				icon: "bookmark",
				title: "Title link",
				desc: "Show the video's title as the link.",
				run: () => void this.pasteTitledLink(editor, from, to, url),
			},
			{
				icon: "link",
				title: "Plain link",
				desc: "Keep the URL exactly as pasted.",
				run: () => undefined,
			},
		]);
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
			new Notice("Could not fetch the video title, so the link was kept.");
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
			new Notice("No YouTube link in your clipboard. Paste one into the block.");
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
			.setName("Ask what to do when pasting a YouTube link")
			.setDesc("Shows a small menu: embed the video, use its title as the link, or keep the plain link.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.pasteMenu).onChange(async (value) => {
					this.plugin.settings.pasteMenu = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Default video width")
			.setDesc("Starting width for regular videos, like 100% or 640px. Drag the handle on an embed's right edge to resize just that one.")
			.addText((t) =>
				t.setValue(this.plugin.settings.maxWidth).onChange(async (value) => {
					this.plugin.settings.maxWidth = value.trim() || DEFAULT_SETTINGS.maxWidth;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Default Shorts width")
			.setDesc("Starting width for vertical Shorts, like 360px.")
			.addText((t) =>
				t.setValue(this.plugin.settings.shortsMaxWidth).onChange(async (value) => {
					this.plugin.settings.shortsMaxWidth = value.trim() || DEFAULT_SETTINGS.shortsMaxWidth;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Privacy-enhanced mode")
			.setDesc("Load videos from youtube-nocookie.com, so YouTube doesn't set tracking cookies until you press play. Reopen notes to apply.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.privacyMode).onChange(async (value) => {
					this.plugin.settings.privacyMode = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
