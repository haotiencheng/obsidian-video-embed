export interface ParsedVideo {
	videoId?: string;
	playlistId?: string;
	start?: number;
	isShort: boolean;
}

export interface BlockOptions {
	url: string;
	start?: number;
	end?: number;
	caption?: string;
	/** Instagram creator handle shown on the card, with or without "@". */
	author?: string;
	vertical?: boolean;
	width?: string;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/;

/** Parse "90", "1:30", "1:02:03", "1m30s", "1h2m3s" into seconds. */
export function parseTime(value: string | null | undefined): number | undefined {
	if (!value) return undefined;
	const v = value.trim();
	if (/^\d+s?$/.test(v)) return parseInt(v, 10);
	if (/^\d+(:\d{1,2}){1,2}$/.test(v)) {
		return v.split(":").reduce((acc, part) => acc * 60 + parseInt(part, 10), 0);
	}
	const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
	if (m && (m[1] || m[2] || m[3])) {
		return parseInt(m[1] ?? "0", 10) * 3600 + parseInt(m[2] ?? "0", 10) * 60 + parseInt(m[3] ?? "0", 10);
	}
	return undefined;
}

/** Accepts any common YouTube URL form, or a bare 11-character video id. */
export function parseYouTube(input: string): ParsedVideo | null {
	const raw = input.trim();
	if (VIDEO_ID.test(raw)) return { videoId: raw, isShort: false };

	let url: URL;
	try {
		url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
	} catch {
		return null;
	}
	if (!YOUTUBE_HOSTS.test(url.hostname)) return null;

	const parts = url.pathname.split("/").filter(Boolean);
	let videoId: string | undefined;
	let isShort = false;

	if (url.hostname.endsWith("youtu.be")) {
		videoId = parts[0];
	} else if (parts[0] === "watch") {
		videoId = url.searchParams.get("v") ?? undefined;
	} else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) {
		videoId = parts[1];
		isShort = parts[0] === "shorts";
	}
	if (videoId === "videoseries") videoId = undefined;
	if (videoId && !VIDEO_ID.test(videoId)) return null;

	const playlistId = url.searchParams.get("list") ?? undefined;
	if (!videoId && !playlistId) return null;

	const start = parseTime(url.searchParams.get("t") ?? url.searchParams.get("start"));
	return { videoId, playlistId, start, isShort };
}

/**
 * Block body: the first line without a "key:" prefix is the URL. Options:
 *   start: 1:23    end: 2:00    caption: text    vertical: true|false    width: 480px
 */
export function parseBlock(source: string): BlockOptions | null {
	const opts: Partial<BlockOptions> = {};
	for (const line of source.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const kv = trimmed.match(/^(start|end|caption|vertical|width|url|author)\s*:\s*(.*)$/i);
		if (!kv) {
			if (opts.url === undefined) opts.url = trimmed;
			continue;
		}
		const key = kv[1].toLowerCase();
		const value = kv[2].trim();
		if (key === "url") opts.url = value;
		else if (key === "start") opts.start = parseTime(value);
		else if (key === "end") opts.end = parseTime(value);
		else if (key === "caption") opts.caption = value;
		else if (key === "vertical") opts.vertical = /^(true|yes|1)$/i.test(value);
		else if (key === "width") opts.width = value;
		else if (key === "author") opts.author = value.replace(/^@/, "");
	}
	return opts.url ? (opts as BlockOptions) : null;
}

export interface ParsedInstagram {
	kind: "p" | "reel";
	shortcode: string;
	/** Present when the link has the instagram.com/<user>/reel/<code>/ form. */
	username?: string;
}

const INSTAGRAM_HOSTS = /(^|\.)(instagram\.com|instagr\.am)$/;
const SHORTCODE = /^[A-Za-z0-9_-]{5,}$/;

/**
 * Instagram post or reel URL, including /reels/, /tv/ and the newer
 * instagram.com/<user>/p/<code>/ form. Profiles and stories return null.
 */
export function parseInstagram(input: string): ParsedInstagram | null {
	const raw = input.trim();
	let url: URL;
	try {
		url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
	} catch {
		return null;
	}
	if (!INSTAGRAM_HOSTS.test(url.hostname)) return null;

	const parts = url.pathname.split("/").filter(Boolean);
	const i = parts.findIndex((p) => ["p", "reel", "reels", "tv"].includes(p));
	const shortcode = i >= 0 ? parts[i + 1] : undefined;
	if (!shortcode || !SHORTCODE.test(shortcode)) return null;
	const post: ParsedInstagram = { kind: parts[i] === "p" ? "p" : "reel", shortcode };
	if (i === 1 && /^[A-Za-z0-9._]{1,30}$/.test(parts[0])) post.username = parts[0];
	return post;
}

export function buildInstagramEmbedUrl(post: ParsedInstagram): string {
	return `https://www.instagram.com/${post.kind}/${post.shortcode}/embed/`;
}

/** A whole-clipboard Instagram post or reel URL (no surrounding text), or null. */
export function pastedInstagramUrl(text: string): ParsedInstagram | null {
	const t = text.trim();
	if (!t || /\s/.test(t)) return null;
	return parseInstagram(t);
}

/** A whole-clipboard YouTube URL (no surrounding text), or null. */
export function pastedYouTubeUrl(text: string): ParsedVideo | null {
	const t = text.trim();
	if (!t || /\s/.test(t) || !/^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be)\//i.test(t)) return null;
	return parseYouTube(t);
}

/** Rewrite a block body so it has exactly one `width:` line, or none when width is null. */
export function setBlockWidth(body: string[], width: string | null): string[] {
	const kept = body.filter((line) => !/^\s*width\s*:/i.test(line));
	while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
	return width ? [...kept, `width: ${width}`] : kept;
}

/** Escape characters that would break a markdown link label. */
export function escapeLinkText(text: string): string {
	return text.replace(/([[\]\\])/g, "\\$1");
}

export function buildEmbedUrl(
	video: ParsedVideo,
	opts: { start?: number; end?: number; privacyMode: boolean },
): string {
	const host = opts.privacyMode ? "https://www.youtube-nocookie.com" : "https://www.youtube.com";
	const path = video.videoId ? `/embed/${video.videoId}` : "/embed/videoseries";
	const params = new URLSearchParams();
	if (video.playlistId) params.set("list", video.playlistId);
	const start = opts.start ?? video.start;
	if (start) params.set("start", String(start));
	if (opts.end) params.set("end", String(opts.end));
	params.set("rel", "0");
	return `${host}${path}?${params.toString()}`;
}
