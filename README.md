# YouTube Embed for Obsidian

Embed YouTube videos, Shorts, and playlists in a note, Notion style.

## Paste a link

Paste a YouTube link into a note. A small card asks how to show it:

| Choice                       | Result                                         |
| ---------------------------- | ---------------------------------------------- |
| **Embed video** (default)    | The video plays inside the note                |
| **Title link**               | `[Video title](url)`                           |
| **Plain link**               | The URL, exactly as pasted                     |

`↑` `↓` to choose, `Enter` to apply, `Esc` or a click elsewhere keeps the plain link. If you just keep typing, the card closes and nothing is lost.

## Resize

Hover an embed and drag the handle on its right edge. The width is saved into the block as `width: 480px`. Double-click the handle to go back to the default width.

## Turn it back into a link

Hover an embed and click the small × in its top-right corner. The whole block becomes the bare URL again. Cmd/Ctrl+Z brings the embed back.

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

**Insert YouTube embed**: inserts a `youtube` block at the cursor, pre-filled with the clipboard URL if it is a YouTube link.

## Settings

- **Ask what to do when pasting a YouTube link** (default on).
- **Default video width**: starting width for 16:9 videos (default `100%`).
- **Default Shorts width**: starting width for vertical videos (default `360px`).
- **Privacy-enhanced mode** (default on): loads from `youtube-nocookie.com`.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production build
npm test        # parser unit tests (Node 22+)
```

Copy `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/youtube-embed/`.
