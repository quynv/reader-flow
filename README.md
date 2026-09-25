# Reader Flow

A reader mode for Chrome and Edge that stitches the following pages of an article together as you read, keeps images, video and audio, translates with an LLM running on your own machine, and reads aloud with your browser's voices.

## Installation

1. Unzip the `reader-flow` folder.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

After updating to a new version, click **Reload** on the extension card. The right-click menu entries are only registered on install or reload.

## Basic use

- Open reader mode by clicking the toolbar icon, pressing `Alt+R`, or right-clicking the page and choosing **Open in Reader Flow**. Press `Esc` or click **×** to choose how to leave. **Leave temporarily** keeps the parsed article, completed translations, and reading position in this tab; use the toolbar icon or `Alt+R` to resume. Translation in progress pauses and resumes when you reopen. **Leave permanently** discards the reading session. Reloading or navigating away also loses a temporary session.
- While you read page 1, page 2 loads in the background. When you reach page 2, page 3 is found and loaded, and so on up to **Maximum pages**. **Pages to preload** controls how far ahead it loads; set it to 0 to load only when you scroll near the end.
- Pages that need JavaScript to show their content are opened briefly in an inactive background tab, read, and closed again.

## Finding the next page

The next-page link is scored from several signals, and the highest score wins:

- `<link rel="next">` or `<a rel="next">`.
- Link text such as Next, Older posts, Trang sau, Chương sau, 次へ, 下一页, 다음, Suivant, Weiter…
- The link to page N+1 inside a pagination block, or a URL that is the current URL with one number increased.
- **Multi-part articles** (Medium, blogs, tutorials): "Part 1", "Chapter 3", "Phần 1", "第1回"… is read from the URL or title, and the extension looks for the link to part N+1, even when it sits in the middle of a sentence ("…in the next tutorial"). If the article has a series table of contents that includes the current page, the entry right after it is taken. A table of contents or intro repeated in every part is only shown once.

If the next page is detected wrongly or not at all, open **Settings → Pick the "Next" button** and click that button on the original page. The rule is saved for that domain.

## Content cleanup

After Readability extracts the article, Reader Flow also removes:

- Share buttons (email, Facebook, X, Hatena, LINE, Zalo, Pinterest, Reddit…), detected by their link targets rather than class names.
- Stand-alone ad labels such as [PR], 広告, Quảng cáo, Sponsored.
- Empty list items and buttons without text.
- Site name, author and date lines at the top of the article. The date is moved under the title.
- A duplicated title at the start of the body, and a trailing "：Site name" in the title.

If something is still left over, open **Settings → Hide clutter** and click it (`↑` selects the surrounding block, `Esc` finishes). The hidden text is remembered per domain, so later pages and later visits hide it too. In **Options → Site rules** you can also add CSS selectors to remove from the original page before extraction.

## Video and audio

- Images (including lazy-loaded ones), `<video>`, `<audio>`, `<picture>` and embeds from YouTube, Vimeo, SoundCloud, Spotify, Bilibili, Niconico and others are kept.
- Elementor E-Gallery images are restored from their full-size links or background-image thumbnails, even when the gallery contains no `<img>` elements.
- Media inside link-heavy blocks (such as tutorial "example" boxes) is kept: media is held by placeholders that Readability never cleans away. If Readability still drops the block around a video, the video is put back next to the paragraph that came right before (or after) it on the original page.
- Players built as web components (`<hls-video src="….m3u8">`, `<mux-player playback-id="…">`, video.js v10 and similar) are recognized, including videos that live inside a component's shadow DOM.
- **Borrowing the page's player iframe (current page only):** iframes are moved into the reader with `Element.moveBefore()` (Chrome 133+), which keeps them running without reloading. This matters for players that the page drives through `postMessage`, such as BBC's SMP (`emp.bbc.co.uk/…/iframe.html`), which would be empty if opened fresh. A **⧉** picture-in-picture button is added inside the player iframe itself (the click has to happen inside that frame). On pages loaded later, such controlled iframes are replaced by a link to the original page.
- **View on the page:** when a video can be neither reproduced nor borrowed, **View on the page** hides the reader, scrolls the original page to the player and shows a **← Back to reader** button.
- A site's own player iframe (for example BBC) is kept when it allows fullscreen/autoplay and is on the same site or looks like a player/embed URL; ad, analytics and widget iframes are ignored.
- When the article has no media at all, the page's own embeddable player is used if it declares one in `og:video` (type `text/html`) or `twitter:player`, as TED does.
- YouTube and Vimeo addresses given as a `<video>` source (MediaElement, Plyr) become normal embeds.
- On the current page, if the extracted content ends up with no media but the page shows a large video (for example a hero video on a product page), that video is placed at the top. A large video with a known source is preferred, then a declared embeddable player, then borrowing the live player.
- Most site players (video.js, JW Player, Plyr, MediaElement, Flowplayer, Shaka…) are replaced by a clean `<video>` element, so no control text ("Current Time", "Duration", "720p"…) leaks into the article. DPlayer instead stays on the original page and offers a **Picture-in-picture** button in the reader, since a copied video may not play without DPlayer's page scripts. On later pages without a live player, the reader links to the original page.
- For videos that play from a `blob:` URL, the real source is looked up in this order:
  1. Attributes of the video container, such as `data-vid`, `data-video`, `data-src` or `data-hls`. For example, kenh14 uses `type="VideoStream" data-vid="kenh14cdn.com/…mp4"`.
  2. JSON-LD `VideoObject`.
  3. `og:video`.
  4. On the page that is currently open, the `.m3u8` / `.mp4` files the site's player actually loaded.
- **Substack**: the post's own video or podcast lives in the player at the top of the page, outside the article body, so it is added back from the page data (`window._preloads`): videos use `/api/v1/video/upload/<id>/src?type=mp4` on the same domain, with `type=hls` as a fallback. Inline Substack video embeds and Substack's YouTube embeds are restored too.
- HLS sources (`.m3u8`) play through hls.js, which is only loaded when a page really contains HLS video.
- **Borrowing the page's own player (current page only):** when no source can be found, or the guessed source fails to play, the page's real `<video>` element is moved into the reader. Its `blob:` stream, cookies and DRM keys travel with the element, so it plays exactly as on the original page, including protected video. A small bar under it offers picture-in-picture and a link to the original page. When reader mode closes, the element is put back in its original place with its original attributes.
- If the site rebuilds its player and takes the element back, or the video is on a page loaded later (page 2 onwards), a **Picture-in-picture** button (when the page still has the player) and a link to the original page are shown instead.
- Segments of HLS/DASH streams (`init.mp4`, `seg-1.mp4`…) are never mistaken for playable sources.

## Translation with a local LLM

### Servers

**Ollama** (default `http://localhost:11434`):

```bash
ollama pull qwen2.5:7b
# If Ollama answers 403, allow the extension origin and restart Ollama:
# macOS:   launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
# Linux:   add Environment="OLLAMA_ORIGINS=chrome-extension://*" to the ollama service
# Windows: set the user environment variable OLLAMA_ORIGINS=chrome-extension://*
```

**LM Studio, llama.cpp server, vLLM, Jan**: choose **OpenAI-compatible** and enter the base address including `/v1`, for example `http://localhost:1234/v1` (LM Studio) or `http://localhost:8080/v1` (llama-server).

In **Options**, use **Fetch list** to see the available models and **Translate a test sentence** to check the connection.

### Using it

- Click **Translate** in the toolbar. The button changes to **Stop translating**.
- Stopping cancels running requests immediately, including on the LLM side, and keeps what has already been translated. Click **Translate** again to continue.
- **Show translation** (bilingual or translation only) and **Remove translations** are in **Settings**.
- To start translating every time reader mode opens, enable **Start translating automatically when reader mode opens** in **Options**.
- Links, bold and italic text, and images inside paragraphs are preserved.

### Whole-page translation

- By default each page is sent in a single request, with its paragraphs wrapped in `<s1>…</s1>`, `<s2>…</s2>`…, so the model sees the full context. The translation still appears paragraph by paragraph while it streams.
- Pages longer than **Max characters per request** (default 4000) are split into consecutive parts, and each part receives the end of the previous one.
- Paragraphs the model skips are re-translated individually.
- Malformed tags from small models (`[s1>`, `＜s1＞`, `【s1】`…) are repaired automatically.
- **Paragraph by paragraph** is still available in **Options** for weaker machines.

### Summary of previous pages

Before translating page N, Reader Flow builds a running summary of pages 1…N-1 in the target language and includes it in the prompt. The summary covers the content, the people and how they address each other, the tone, and a glossary of names and recurring terms. Click **Context used to translate this page** at the top of each page to see it.

Translation-only models such as Hy-MT and TranslateGemma summarize poorly, so set **Summary model** to a chat model such as Qwen or Gemma. With llama-server this requires router mode (several models).

### Model profiles

Hy-MT and TranslateGemma are recognized from the model name. They receive a single user message without a system prompt, and Hy-MT also gets its recommended sampling settings (temperature 0.7, top_p 0.6, top_k 20). You can override the profile in **Options**.

### Context size

A request now holds a whole page, the summary and the translation.

- With Ollama, the extension sends `num_ctx` 16384; you can change it in **Options**.
- With llama-server, start it with enough context, for example `-c 32768 -np 2`. Note that `-np N` splits the context between N slots.

### Translate selection

On any page, including reader mode, select text, right-click and choose **Translate selection**. The translation appears in a small panel next to the selection, with **Listen** and **Copy** buttons. Inside reader mode the panel also uses the article title and the summary of previous pages as context.

## Read aloud

- Click **Listen** in the toolbar to start reading from the paragraph you are looking at, using the voices of your browser and operating system.
- The player has previous/next paragraph, play/pause, speed, and a choice between the original and the translation.
- Double-click a paragraph to read from there.
- When the loaded content runs out, the next page is loaded and reading continues.
- In **Auto** mode, paragraphs that already have a translation are read in translation. While translation is running, it waits for each paragraph to be translated.
- Choose a voice per language in **Options → Read aloud**. If a language such as Vietnamese or Japanese is missing, install its speech pack in your operating system's language settings and restart the browser.

## Fonts

- **Literata** (serif) and **Inter** (sans-serif) are bundled in `fonts/` under the SIL Open Font License 1.1 and cover Vietnamese diacritics fully.
- They are loaded with `FontFace` from binary data, so they work even on pages whose CSP blocks fonts. System fonts can be selected in **Settings**.
- When a page does not declare `lang`, Vietnamese, Japanese or Korean is guessed so that line spacing and CJK fonts are chosen correctly.

## Interface language

- **English**, **Tiếng Việt** and **日本語** are included. The default follows the browser language.
- Change it in **Settings → Interface language** (applies immediately, without reloading) or in **Options**.
- If the translation target language is left empty, it also follows the interface language.

To add a language:

1. Copy `_locales/en/messages.json` to `_locales/<code>/messages.json` (for example `ko`, `zh_CN`) and translate the `message` values. Keep `{1}`, `{2}` and any HTML in keys ending with `Html`.
2. Add the code to `RF_LOCALES`, `RF_LOCALE_NAMES` and `RF_LOCALE_TARGET` in `lib/i18n.js`.

The extension name and description in `chrome://extensions` use `__MSG_…__` and therefore always follow the browser language; this is a Chrome limitation.

## Project structure

- `content.js`: reader UI (Shadow DOM), progressive page loading, next-button picker, hide-clutter mode, selection panel, player UI.
- `background.js`: script injection, cross-origin fetching, JavaScript rendering in a background tab, LLM streaming, context menus.
- `lib/nextpage.js`: next-page detection (rel=next, link text, page numbers, URL increments, multi-part series, per-site rules).
- `lib/extract.js`: Readability plus media preservation, lazy images, video source recovery, image galleries, cleanup passes.
- `lib/translate.js`: whole-page translation with placeholder tags for inline markup, running summaries, selection translation.
- `lib/tts.js`: read aloud with the Web Speech API.
- `lib/fonts.js` and `fonts/`: Literata and Inter (latin, latin-ext, vietnamese).
- `lib/i18n.js` and `_locales/`: interface translations, switchable while reading.
- `lib/reader-css.js`: styles for the reader and the selection panel.
- `lib/settings.js`, `options.html`, `options.js`: settings and the Options page.
- `lib/hls.light.min.js`: hls.js 1.7 (Apache-2.0), loaded on demand.
- `lib/Readability.js`: Mozilla Readability 0.6.0 (Apache-2.0).

## Permissions

- `<all_urls>` host access is needed to fetch following pages from the same or related domains and to reach a local LLM at `localhost`.
- `scripting` and `activeTab` inject the reader into the current tab.
- `storage` keeps settings and per-site rules.
- `contextMenus` adds **Open in Reader Flow** and **Translate selection**.

Nothing is sent anywhere except to the pages you read and the LLM server you configure.

## Known limitations

- "Load more" buttons that only fire AJAX requests, without a real link, are not followed.
- Videos on pages loaded after the first one cannot borrow a live player; if their source cannot be found they fall back to a link to the original page. On some systems, DRM video with hardware protection may show a black picture after being moved; use picture-in-picture or the original page then.
- HLS streams on a different domain need that CDN to allow cross-origin requests, as the site's own player does.
- Pages that need JavaScript are opened briefly in an inactive background tab and closed again.
