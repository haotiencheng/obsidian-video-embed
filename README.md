# YouTube Embed for Obsidian

Embed YouTube videos, Shorts, and playlists in a note with a `youtube` code block.

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
| `width`    | `480px`, `60%`           | Overrides the max width setting for this block     |

Accepted URLs: `youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`, `m.youtube.com`, playlists (`?list=`), and bare 11-character video ids.

## Command

**Insert YouTube embed**: inserts a `youtube` block at the cursor, pre-filled with the clipboard URL if it is a YouTube link.

## Settings

- **Privacy-enhanced mode** (default on): loads from `youtube-nocookie.com`.
- **Max width**: cap for 16:9 videos (default `100%`).
- **Shorts max width**: cap for vertical videos (default `360px`).

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production build
npm test        # parser unit tests (Node 22+)
```

Copy `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/youtube-embed/`.
