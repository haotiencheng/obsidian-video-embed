# YouTube Embed for Obsidian

Embed YouTube videos, Shorts, and playlists in a note, Notion style.

![Paste a YouTube link, embed it, resize, edit, and turn it back into a link](https://raw.githubusercontent.com/haotiencheng/obsidian-youtube-embed/main/assets/demo.gif)

## Paste a link

Paste a YouTube link into a note. A small card asks how to show it:

| Choice                       | Result                                         |
| ---------------------------- | ---------------------------------------------- |
| **Embed video** (default)    | The video plays inside the note                |
| **Title link**               | `[Video title](url)`                           |
| **Plain link**               | The URL, exactly as pasted                     |

`↑` `↓` to choose, `Enter` to apply, `Esc` or a click elsewhere keeps the plain link. If you just keep typing, the card closes and nothing is lost.

## Instagram

Paste an Instagram post or reel link and choose **Embed reel** (or **Embed post**). It becomes an `instagram` block that shows the creator and the media as a clean card, using Instagram's official embed. Pressing play opens the reel on Instagram, since Instagram doesn't allow playback inside other apps.

````markdown
```instagram
https://www.instagram.com/reel/DZWGtwrRPIC/
```
````

Instagram cards can be resized between 326px and 540px wide.

## Resize

Hover an embed and drag the handle on its right edge. The width is saved into the block as `width: 480px`. Double-click the handle to go back to the default width.

## Edit or remove

Hover an embed. Two small buttons appear in its top-right corner:

- **Pencil**: opens the block's source with the link and options selected, so you can change the link, `start`, `caption`, and so on. Works from Reading view too.
- **×**: removes the embed and leaves the bare URL. Cmd/Ctrl+Z brings the embed back.

## Code block

````markdown
```youtube
https://youtube.com/shorts/TfTAB6F-kW0
caption: How Ling Long got hired
```
````

Shorts render vertical (9:16). Everything else renders 16:9.

## Block options

The first line without a `key:` prefix is the URL. Every option is optional.

````markdown
```youtube
https://www.youtube.com/watch?v=jNQXAC9IVRw
start: 0:05
end: 1:30
caption: Text under the video
vertical: false
width: 480px
```
````

| Option     | Example                  | Notes                                              |
| ---------- | ------------------------ | -------------------------------------------------- |
| `url`      | `url: TfTAB6F-kW0`       | Same as a bare URL line                            |
| `start`    | `90`, `1:30`, `1m30s`    | Overrides `t=` in the URL                          |
| `end`      | `2:00`                   | Stop time                                          |
| `caption`  | any text                 | Shown under the video, also the iframe title       |
| `vertical` | `true` / `false`         | Force 9:16 or 16:9                                 |
| `width`    | `480px`, `60%`           | Set by dragging; overrides the default width       |

Accepted URLs: `youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`, `m.youtube.com`, playlists (`?list=`), and bare 11-character video ids.

## Command

**Insert video**: inserts an empty `youtube` block at the cursor, ready for a link.

The plugin never reads your clipboard on its own. It only looks at what you paste, at the moment you paste it, to check whether it is a lone YouTube link.

Requires Obsidian 1.13 or later.

## Settings

- **Default video width**: starting width for 16:9 videos (default `100%`).
- **Default width for vertical videos**: starting width for Shorts (default `360px`).

Videos always load from `youtube-nocookie.com`, YouTube's privacy-enhanced domain.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production build
npm test        # parser unit tests (Node 22+)
```

Copy `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/youtube-embed/`.
