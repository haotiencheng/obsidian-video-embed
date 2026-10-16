import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEmbedUrl, parseBlock, parseTime, parseYouTube } from "../parse.ts";

test("parseTime handles seconds, clock and h/m/s forms", () => {
	assert.equal(parseTime("90"), 90);
	assert.equal(parseTime("90s"), 90);
	assert.equal(parseTime("1:30"), 90);
	assert.equal(parseTime("1:02:03"), 3723);
	assert.equal(parseTime("1m30s"), 90);
	assert.equal(parseTime("1h2m3s"), 3723);
	assert.equal(parseTime("abc"), undefined);
	assert.equal(parseTime(""), undefined);
});

test("parseYouTube recognizes common URL forms", () => {
	const id = "TfTAB6F-kW0";
	assert.deepEqual(parseYouTube(id), { videoId: id, isShort: false });
	assert.equal(parseYouTube(`https://www.youtube.com/watch?v=${id}`)?.videoId, id);
	assert.equal(parseYouTube(`https://m.youtube.com/watch?v=${id}&t=1m5s`)?.start, 65);
	assert.equal(parseYouTube(`https://youtu.be/${id}?t=42`)?.start, 42);
	assert.equal(parseYouTube(`youtube.com/embed/${id}`)?.videoId, id);
	assert.equal(parseYouTube(`https://www.youtube.com/live/${id}`)?.videoId, id);

	const short = parseYouTube(`https://youtube.com/shorts/${id}?si=jm_bdaMU3_Ctq1qD`);
	assert.equal(short?.videoId, id);
	assert.equal(short?.isShort, true);
});

test("parseYouTube handles playlists", () => {
	const list = parseYouTube("https://www.youtube.com/playlist?list=PLabc123");
	assert.equal(list?.videoId, undefined);
	assert.equal(list?.playlistId, "PLabc123");

	const both = parseYouTube("https://www.youtube.com/watch?v=TfTAB6F-kW0&list=PLabc123");
	assert.equal(both?.videoId, "TfTAB6F-kW0");
	assert.equal(both?.playlistId, "PLabc123");
});

test("parseYouTube rejects non-YouTube input", () => {
	assert.equal(parseYouTube("https://vimeo.com/123"), null);
	assert.equal(parseYouTube("https://notyoutube.com/watch?v=TfTAB6F-kW0"), null);
	assert.equal(parseYouTube("https://www.youtube.com/@someone"), null);
	assert.equal(parseYouTube("hello world"), null);
});

test("parseBlock reads URL and options", () => {
	const opts = parseBlock("\nhttps://youtu.be/TfTAB6F-kW0\nstart: 0:10\nend: 30\ncaption: Ling Long: origin\nvertical: no\nwidth: 480px\n");
	assert.deepEqual(opts, {
		url: "https://youtu.be/TfTAB6F-kW0",
		start: 10,
		end: 30,
		caption: "Ling Long: origin",
		vertical: false,
		width: "480px",
	});
	assert.equal(parseBlock("url: TfTAB6F-kW0")?.url, "TfTAB6F-kW0");
	assert.equal(parseBlock("caption: only"), null);
});

test("buildEmbedUrl builds privacy and playlist URLs", () => {
	const v = parseYouTube("https://youtu.be/TfTAB6F-kW0?t=5")!;
	assert.equal(
		buildEmbedUrl(v, { privacyMode: true }),
		"https://www.youtube-nocookie.com/embed/TfTAB6F-kW0?start=5&rel=0",
	);
	assert.equal(
		buildEmbedUrl(v, { start: 20, end: 40, privacyMode: false }),
		"https://www.youtube.com/embed/TfTAB6F-kW0?start=20&end=40&rel=0",
	);
	const p = parseYouTube("https://www.youtube.com/playlist?list=PLabc123")!;
	assert.equal(
		buildEmbedUrl(p, { privacyMode: true }),
		"https://www.youtube-nocookie.com/embed/videoseries?list=PLabc123&rel=0",
	);
});
