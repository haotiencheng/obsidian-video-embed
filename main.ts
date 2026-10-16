import {
	App,
	Editor,
	EditorPosition,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	SettingDefinitionItem,
	TFile,
	requestUrl,
	setIcon,
} from "obsidian";
import {
	buildEmbedUrl,
	buildInstagramEmbedUrl,
	buildTikTokPlayerUrl,
	escapeLinkText,
	parseBlock,
	parseInstagram,
	parseTikTok,
	parseYouTube,
	pastedInstagramUrl,
	pastedTikTokUrl,
	pastedYouTubeUrl,
	setBlockWidth,
} from "./parse";
import { PasteChoice, PastePrompt } from "./paste-prompt";

/** The slice of CodeMirror's EditorView we use, exposed as `editor.cm`. */
interface CodeMirrorView {
	coordsAtPos(pos: number): { left: number; top: number; bottom: number } | null;
}

interface VideoEmbedSettings {
	maxWidth: string;
	shortsMaxWidth: string;
}

const DEFAULT_SETTINGS: VideoEmbedSettings = {
	maxWidth: "100%",
	shortsMaxWidth: "360px",
};

const MIN_WIDTH = 200;

// Instagram's embed page: a 54px header, the media, then a 154px footer (likes,
// comment box) that we clip. Widths outside 326–540px are not supported by Instagram.
const IG_HEADER = 54;
const IG_FOOTER = 154;
const IG_MIN_WIDTH = 326;
const IG_MAX_WIDTH = 540;
const IG_DEFAULT_WIDTH = "400px";

export default class VideoEmbedPlugin extends Plugin {
	settings: VideoEmbedSettings;
	private prompt: PastePrompt | null = null;
	/** Instagram iframes report their content height via postMessage; keyed by iframe window. */
	private igMeasure = new WeakMap<MessageEventSource, (height: number) => void>();

	async onload() {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor("youtube", (source, el, ctx) => this.renderBlock(source, el, ctx));
		this.registerMarkdownCodeBlockProcessor("instagram", (source, el, ctx) => this.renderInstagram(source, el, ctx));
		this.registerMarkdownCodeBlockProcessor("tiktok", (source, el, ctx) => this.renderTikTok(source, el, ctx));
		this.registerDomEvent(window, "message", (e) => this.onInstagramMessage(e));

		this.registerEvent(
			this.app.workspace.on("editor-paste", (evt, editor) => this.onPaste(evt, editor)),
		);

		this.addCommand({
			id: "insert-block",
			name: "Insert video",
			editorCallback: (editor: Editor) => this.insertBlock(editor),
		});

		this.addSettingTab(new VideoEmbedSettingTab(this.app, this));
	}

	onunload() {
		this.prompt?.close();
	}

	renderBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const opts = parseBlock(source);
		const video = opts ? parseYouTube(opts.url) : null;
		if (!opts || !video) {
			el.createDiv({
				cls: "video-embed-error",
				text: "YouTube embed: put a YouTube link on the first line of this block.",
			});
			return;
		}

		const vertical = opts.vertical ?? video.isShort;
		this.markHost(el);
		const figure = el.createEl("figure", {
			cls: ["video-embed", vertical ? "is-vertical" : "is-horizontal"],
		});
		figure.style.setProperty(
			"--video-embed-max-width",
			opts.width ??
				(vertical
					? this.settings.shortsMaxWidth.trim() || DEFAULT_SETTINGS.shortsMaxWidth
					: this.settings.maxWidth.trim() || DEFAULT_SETTINGS.maxWidth),
		);

		const frame = figure.createDiv({ cls: "video-embed-frame" });
		frame.createEl("iframe", {
			attr: {
				src: buildEmbedUrl(video, {
					start: opts.start,
					end: opts.end,
					privacyMode: true,
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
		this.addActions(figure, el, ctx, opts.url);

		if (opts.caption) figure.createEl("figcaption", { text: opts.caption });
	}

	renderInstagram(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const opts = parseBlock(source);
		const post = opts ? parseInstagram(opts.url) : null;
		if (!opts || !post) {
			el.createDiv({
				cls: "video-embed-error",
				text: "Instagram embed: put an Instagram post or reel link on the first line of this block.",
			});
			return;
		}

		this.markHost(el);
		const figure = el.createEl("figure", { cls: ["video-embed", "is-instagram"] });
		figure.style.setProperty("--video-embed-max-width", opts.width ?? IG_DEFAULT_WIDTH);

		const frame = figure.createDiv({ cls: "video-embed-frame" });
		const iframe = frame.createEl("iframe", {
			attr: {
				src: buildInstagramEmbedUrl(post),
				title: opts.caption ?? "Instagram post",
				frameborder: "0",
				scrolling: "no",
				allowtransparency: "true",
				allow: "autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share",
				loading: "lazy",
			},
		});

		// Show only the media: shift Instagram's header out of view and clip the footer.
		// Until Instagram reports its height (and again while resizing), estimate it
		// from the width assuming 4:5 media.
		let measured: number | null = null;
		let measuredAt = 0;
		const layout = () => {
			const width = frame.clientWidth;
			if (!width) return;
			const full = measured !== null && Math.abs(width - measuredAt) < 2
				? measured
				: IG_HEADER + Math.round(width * 1.25) + IG_FOOTER;
			iframe.style.top = `-${IG_HEADER}px`;
			iframe.style.height = `${full}px`;
			frame.style.height = `${full - IG_HEADER - IG_FOOTER}px`;
		};

		// The embed's own header is hidden, so show the credit ourselves.
		const author = opts.author ?? post.username;
		this.addCreatorOverlay(frame, {
			platform: "instagram",
			postUrl: `https://www.instagram.com/${post.kind}/${post.shortcode}/`,
			author,
			authorUrl: author ? `https://www.instagram.com/${author}/` : undefined,
		});
		iframe.addEventListener("load", () => {
			if (!iframe.contentWindow) return;
			this.igMeasure.set(iframe.contentWindow, (height) => {
				measured = height;
				measuredAt = frame.clientWidth;
				layout();
			});
		});
		const observer = new ResizeObserver(layout);
		observer.observe(frame);
		// Tie cleanup to this block's lifetime, not the plugin's.
		const child = new MarkdownRenderChild(el);
		child.register(() => observer.disconnect());
		ctx.addChild(child);

		this.addResizeHandle(figure, el, ctx, { min: IG_MIN_WIDTH, max: IG_MAX_WIDTH });
		this.addActions(figure, el, ctx, opts.url);

		if (opts.caption) figure.createEl("figcaption", { text: opts.caption });
	}

	renderTikTok(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const opts = parseBlock(source);
		const video = opts ? parseTikTok(opts.url) : null;
		if (!opts || !video) {
			el.createDiv({
				cls: "video-embed-error",
				text: "TikTok embed: put a TikTok video link on the first line of this block.",
			});
			return;
		}

		this.markHost(el);
		const figure = el.createEl("figure", { cls: ["video-embed", "is-tiktok", "is-vertical"] });
		figure.style.setProperty(
			"--video-embed-max-width",
			opts.width ?? (this.settings.shortsMaxWidth.trim() || DEFAULT_SETTINGS.shortsMaxWidth),
		);
		const frame = figure.createDiv({ cls: "video-embed-frame" });

		// TikTok's player draws its own creator header and logo, so no overlay here.
		const show = (videoId: string) => {
			frame.createEl("iframe", {
				attr: {
					src: buildTikTokPlayerUrl(videoId),
					title: opts.caption ?? "TikTok video",
					frameborder: "0",
					allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
					allowfullscreen: "true",
					loading: "lazy",
				},
			});
		};

		if (video.videoId) {
			show(video.videoId);
		} else {
			// Short links don't contain the video id; TikTok's public oEmbed resolves it.
			void this.resolveTikTok(video.url).then((videoId) => {
				if (videoId) show(videoId);
				else frame.createDiv({ cls: "video-embed-error", text: "Could not load this TikTok link." });
			});
		}

		this.addResizeHandle(figure, el, ctx);
		this.addActions(figure, el, ctx, opts.url);

		if (opts.caption) figure.createEl("figcaption", { text: opts.caption });
	}

	private tiktokCache = new Map<string, Promise<string | null>>();

	/** Video id for a TikTok short link, via TikTok's public oEmbed endpoint. */
	resolveTikTok(url: string): Promise<string | null> {
		let pending = this.tiktokCache.get(url);
		if (!pending) {
			pending = requestUrl({ url: `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}` })
				.then((res) => (res.json as { embed_product_id?: string }).embed_product_id ?? null)
				.catch(() => null);
			this.tiktokCache.set(url, pending);
		}
		return pending;
	}

	/** Instagram badge top-left (links to the post) and @handle bottom-left (links to the creator). */
	addCreatorOverlay(
		frame: HTMLElement,
		info: { platform: "instagram"; postUrl: string; author?: string; authorUrl?: string },
	) {
		const external = { target: "_blank", rel: "noopener" };
		const badge = frame.createEl("a", {
			cls: ["video-embed-badge", `is-${info.platform}`],
			href: info.postUrl,
			attr: { ...external, "aria-label": "Open the original post" },
		});
		this.drawInstagramGlyph(badge);

		if (info.author) {
			frame.createEl("a", {
				cls: "video-embed-handle",
				text: `@${info.author}`,
				href: info.authorUrl ?? info.postUrl,
				attr: external,
			});
		}
	}

	/** Simple camera glyph (rounded square, lens, flash dot), drawn in white on the badge's gradient. */
	drawInstagramGlyph(parent: HTMLElement) {
		const svg = parent.createSvg("svg", {
			attr: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2" },
		});
		svg.createSvg("rect", { attr: { x: "3", y: "3", width: "18", height: "18", rx: "5" } });
		svg.createSvg("circle", { attr: { cx: "12", cy: "12", r: "4" } });
		svg.createSvg("circle", { attr: { cx: "17.3", cy: "6.7", r: "1", fill: "currentColor", stroke: "none" } });
	}

	onInstagramMessage(e: MessageEvent) {
		if (!e.source || !/^https:\/\/www\.instagram\.com$/.test(e.origin)) return;
		const onHeight = this.igMeasure.get(e.source);
		if (!onHeight) return;
		try {
			const data = (typeof e.data === "string" ? JSON.parse(e.data) : e.data) as {
				type?: string;
				details?: { height?: number };
			};
			if (data.type === "MEASURE" && typeof data.details?.height === "number") onHeight(data.details.height);
		} catch {
			// Not an Instagram embed message.
		}
	}

	/**
	 * Tag Live Preview's block container so CSS can hide its own "edit block" button
	 * (our pencil replaces it) without a :has() selector. The container may not exist
	 * until the block is attached, so retry for a few frames.
	 */
	markHost(el: HTMLElement) {
		let tries = 0;
		const mark = () => {
			const host = el.closest(".cm-embed-block");
			if (host) host.addClass("video-embed-host");
			else if (!el.isConnected && tries++ < 10) el.win.requestAnimationFrame(mark);
		};
		mark();
	}

	/** Drag the right-edge handle to resize; double-click it to reset. Width is saved into the block. */
	addResizeHandle(
		figure: HTMLElement,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
		limits: { min: number; max: number } = { min: MIN_WIDTH, max: Infinity },
	) {
		const handle = figure.createDiv({ cls: "video-embed-resize" });
		// CSS tooltip: shows instantly on hover, independent of Obsidian's delayed tooltips.
		handle.createSpan({ cls: "video-embed-tip", text: "Drag to resize, double-click to reset" });

		handle.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const win = figure.win;
			const startX = e.clientX;
			const startWidth = figure.getBoundingClientRect().width;
			const maxWidth = Math.min(limits.max, (el.parentElement ?? el).getBoundingClientRect().width);
			let width = startWidth;
			figure.addClass("is-resizing");

			const onMove = (ev: PointerEvent) => {
				width = Math.round(Math.max(limits.min, Math.min(maxWidth, startWidth + ev.clientX - startX)));
				figure.style.setProperty("--video-embed-max-width", `${width}px`);
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

	/** Hover buttons in the top-right corner: edit the block's source, or remove the embed. */
	addActions(figure: HTMLElement, el: HTMLElement, ctx: MarkdownPostProcessorContext, url: string) {
		const actions = figure.createDiv({ cls: "video-embed-actions" });
		const addButton = (icon: string, tip: string, onClick: () => void) => {
			const button = actions.createEl("button", { cls: "video-embed-button" });
			setIcon(button, icon);
			// Doubles as the button's accessible name.
			button.createSpan({ cls: "video-embed-tip", text: tip });
			// mousedown would otherwise put Live Preview into edit mode for the block.
			button.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
			});
			button.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				onClick();
			});
		};
		addButton("pencil", "Edit link and options", () => void this.editSource(el, ctx));
		addButton("x", "Remove embed, keep the link", () => void this.editBlock(el, ctx, () => [url]));
	}

	/** Show the block's source in the editor, switching out of Reading view if needed. */
	async editSource(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const info = ctx.getSectionInfo(el);
		const view = this.findView(ctx.sourcePath);
		if (!info || !view) return;
		if (view.getMode() !== "source") {
			await view.setState({ ...view.getState(), mode: "source" }, { history: false });
		}
		// Like Live Preview's own edit button: select the block body, which reveals its source.
		const editor = view.editor;
		const first = Math.min(info.lineStart + 1, info.lineEnd);
		const last = Math.max(first, info.lineEnd - 1);
		editor.focus();
		editor.setSelection({ line: first, ch: 0 }, { line: last, ch: editor.getLine(last).length });
	}

	findView(path: string): MarkdownView | undefined {
		return this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === path);
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
		const view = this.findView(file.path);

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
		if (evt.defaultPrevented) return;
		if (editor.somethingSelected()) return;
		const text = evt.clipboardData?.getData("text/plain") ?? "";
		const video = pastedYouTubeUrl(text);
		const post = video ? null : pastedInstagramUrl(text);
		const tiktok = video || post ? null : pastedTikTokUrl(text);
		if (!video && !post && !tiktok) return;

		evt.preventDefault();
		const url = text.trim();
		const from = editor.getCursor("from");
		editor.replaceSelection(url);
		const to = editor.getCursor("to");

		const cm = (editor as unknown as { cm?: CodeMirrorView }).cm;
		const coords = cm?.coordsAtPos(editor.posToOffset(to));
		if (!coords) return;

		const plainLink = {
			icon: "link",
			title: "Plain link",
			desc: "Keep the URL exactly as pasted.",
			run: () => undefined,
		};

		const embed = (lang: "youtube" | "instagram" | "tiktok") => () =>
			this.replacePasted(editor, from, to, url, this.blockText(editor, from, to, url, lang));

		let heading: string;
		let choices: PasteChoice[];
		if (video) {
			heading = "YouTube link pasted. Show it as:";
			choices = [
				{
					icon: "play",
					title: video.isShort ? "Embed Short" : "Embed video",
					desc: "Watch it right inside the note.",
					run: embed("youtube"),
				},
				{
					icon: "bookmark",
					title: "Title link",
					desc: "Show the video's title as the link.",
					run: () => void this.pasteTitledLink(editor, from, to, url),
				},
				plainLink,
			];
		} else if (post) {
			heading = "Instagram link pasted. Show it as:";
			choices = [
				{
					icon: post.kind === "reel" ? "film" : "image",
					title: post.kind === "reel" ? "Embed reel" : "Embed post",
					desc: "Preview it right inside the note.",
					run: embed("instagram"),
				},
				plainLink,
			];
		} else {
			heading = "TikTok link pasted. Show it as:";
			choices = [
				{ icon: "play", title: "Embed video", desc: "Watch it right inside the note.", run: embed("tiktok") },
				plainLink,
			];
		}

		this.prompt?.close();
		this.prompt = new PastePrompt(activeWindow, coords, choices, heading);
	}

	/** Wrap the code block in newlines when the URL was pasted mid-line. */
	blockText(
		editor: Editor,
		from: EditorPosition,
		to: EditorPosition,
		url: string,
		lang: "youtube" | "instagram" | "tiktok",
	): string {
		const before = editor.getLine(from.line).slice(0, from.ch);
		const after = editor.getLine(to.line).slice(to.ch);
		return `${before.trim() ? "\n" : ""}\`\`\`${lang}\n${url}\n\`\`\`${after.trim() ? "\n" : ""}`;
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

	/** Insert an empty youtube block and put the cursor where the link goes. */
	insertBlock(editor: Editor) {
		const cursor = editor.getCursor();
		const prefix = cursor.ch === 0 ? "" : "\n";
		editor.replaceRange(`${prefix}\`\`\`youtube\n\n\`\`\`\n`, cursor);
		editor.setCursor({ line: cursor.line + (prefix ? 2 : 1), ch: 0 });
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<VideoEmbedSettings> | null;
		// Pick known keys only, so options removed in older versions are dropped on next save.
		this.settings = {
			maxWidth: saved?.maxWidth ?? DEFAULT_SETTINGS.maxWidth,
			shortsMaxWidth: saved?.shortsMaxWidth ?? DEFAULT_SETTINGS.shortsMaxWidth,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class VideoEmbedSettingTab extends PluginSettingTab {
	plugin: VideoEmbedPlugin;

	constructor(app: App, plugin: VideoEmbedPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Declarative settings: rendered by Obsidian and indexed by settings search.
	// PluginSettingTab reads and saves `plugin.settings[key]` for each control.
	getSettingDefinitions(): SettingDefinitionItem<keyof VideoEmbedSettings>[] {
		return [
			{
				name: "Default video width",
				desc: "Starting width for regular videos, like 100% or 640px. Drag the handle on an embed's right edge to resize just that one.",
				aliases: ["size", "max width"],
				control: { type: "text", key: "maxWidth", defaultValue: DEFAULT_SETTINGS.maxWidth, placeholder: DEFAULT_SETTINGS.maxWidth },
			},
			{
				name: "Default width for vertical videos",
				desc: "Starting width for vertical short videos, like 360px.",
				aliases: ["shorts"],
				control: { type: "text", key: "shortsMaxWidth", defaultValue: DEFAULT_SETTINGS.shortsMaxWidth, placeholder: DEFAULT_SETTINGS.shortsMaxWidth },
			},
		];
	}
}
