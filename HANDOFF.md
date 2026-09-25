# Reader Flow — handoff context for a coding agent

Paste this whole file into the agent (or keep it at the repo root as `HANDOFF.md`). It describes what exists, how it is wired, the conventions to keep, how to test, and what is still open.

## 1. What the product is

Reader Flow is a Chrome/Edge **Manifest V3 extension** (no build step, plain JS). It has five main features:

- **Reader mode:** opens as a full-page overlay in a Shadow DOM on the current page.
- **Progressive page stitching:** while the user reads page N, page N+1 is found and loaded, up to `maxPages`.
- **Media preservation:** images, video (including HLS and `blob:` players) and audio are kept or rebuilt.
- **Local-LLM translation:** Ollama or any OpenAI-compatible server (llama.cpp / llama-server, LM Studio…).
  - Whole-page translation with a running summary of previous pages.
  - A "Translate selection" item in the right-click menu.
- **Read aloud:** uses the browser's own voices (Web Speech API).

UI languages: English, Vietnamese, Japanese.

The owner is Vietnamese, lives in Tokyo, reads EN/JA/VI content, and runs llama.cpp via llama.app. Recommended translation models are Hy-MT2 (Tencent, 1.8B/7B) and TranslateGemma. Code comments are written in Vietnamese; keep that style when you edit.

## 2. Repository layout

```
reader-flow/            ← the unpacked extension (load this folder in chrome://extensions)
  manifest.json         MV3; permissions: activeTab, scripting, storage, contextMenus; host: <all_urls>
  background.js         service worker (see §4)
  content.js            reader app (class App) + SelectionPopup; injected on demand, never declared in manifest
  options.html/.js/.css Options page
  lib/settings.js       RF_DEFAULTS + rfLoadSettings()/rfSaveSettings() (+ one-time migration of old trMode)
  lib/i18n.js           rfT(key, …args) with {1},{2} placeholders; rfInitI18n(pref); rfApplyI18n(root)
  lib/fetch-util.js     rfFetchHtml(url) with charset detection (Shift_JIS, EUC-JP, GBK…)
  lib/nextpage.js       RFNext.find(doc, url, {visited, rule}) — next-page scoring
  lib/extract.js        RFExtract.extract(doc, url, opts) — Readability + media + cleanup
  lib/translate.js      RFTranslator.Translator (page-level) + quickTranslate + readableBlocks
  lib/tts.js            RFSpeaker.Speaker (Web Speech API only)
  lib/fonts.js          RFFonts.ensure('serif'|'sans'): Literata/Inter via FontFace from binary (CSP-safe)
  lib/reader-css.js     globalThis.RF_CSS (reader) and RF_SEL_CSS (selection popup), used via adoptedStyleSheets
  lib/Readability.js    Mozilla Readability 0.6.0 (unmodified)
  lib/hls.light.min.js  hls.js 1.7.3, injected on demand only
  _locales/{en,vi,ja}/messages.json   GENERATED — do not edit by hand (see §7)
  fonts/, icons/, README.md (English, user-facing)

reader-flow-dev/        ← test harness, kept OUTSIDE the extension folder (Chrome refuses
                          to load extensions containing "_"-prefixed names such as node_modules/)
  package.json          devDeps: jsdom, video.js, mediaelement, mediaelement-plugins
  i18n/messages.py      SOURCE OF TRUTH for all UI strings: M = { key: (en, vi, ja) }
  i18n/build.py         writes ../reader-flow/_locales/*/messages.json
  server/server.py      mock web + mock LLM server on 127.0.0.1:8765, plus fixtures (*.html, media/, series/)
  e2e/*.py              Playwright tests that load the real extension in Chromium
  unit/*.js             jsdom tests for nextpage/extract
```

## 3. Hard conventions (break these and things fail silently)

1. **Re-injectable content scripts.**
   - Every `lib/*.js` loaded into pages uses `var` or assigns to `globalThis.X = (() => {…})()`.
   - `content.js` is wrapped in an IIFE.
   - Never use top-level `const`, `let` or `class` in injected files: a second injection would throw.
2. **Injection order** is fixed in `background.js` `CONTENT_FILES`: Readability, settings, i18n, fetch-util, nextpage, extract, translate, tts, fonts, reader-css, content. `hls.light.min.js` is **not** in this list; it is injected on demand (`rf-load-hls`).
3. **All user-facing strings** go through `rfT('key')`. To add a string:
   - add the key to `reader-flow-dev/i18n/messages.py` in all three languages;
   - run `python3 reader-flow-dev/i18n/build.py`.
   - Keys ending in `Html` are inserted as HTML. The keys are checked for completeness with a small script (see §8).
4. **Sanitizer allow-lists** in `content.js` → `sanitize()`:
   - `KEEP_ATTRS`: any new `data-rf-*` attribute that must survive rendering must be added here.
   - `KEEP_CLASSES`: currently `rf-embed`, `rf-media`, `rf-media-missing`, `rf-transcript`.
   - iframes are allowed only over https, or http when the page itself is http.
5. **Styles** live in `lib/reader-css.js` as a string. They are applied with `CSSStyleSheet.replaceSync` and `adoptedStyleSheets`, so page CSP cannot block them. Do not use `<style>` or `<link>`.
6. **Page CSP:** fetch the extension's own files through the service worker (fonts, locales) instead of the page, and use Web Audio / `FontFace` with binary data.
7. **Settings:**
   - Read with `rfLoadSettings()`; write with `this.save(patch)` in the reader or `rfSaveSettings()` elsewhere.
   - Side effects of setting changes go in `App.afterChange(prev)`. This is called both for local saves and for `chrome.storage.onChanged`.

Settings keys (`RF_DEFAULTS`):

| Group | Keys |
|---|---|
| General | `uiLang` |
| Page stitching | `maxPages`, `prefetchAhead`, `jsRenderFallback`, `renderWaitMs`, `minTextLength` |
| Display | `theme`, `fontFamily`, `fontSize`, `lineWidth`, `lineHeight`, `keepMedia` |
| Translation | `trProvider`, `trEndpoint`, `trModel`, `trApiKey`, `trTargetLang`, `trDisplay`, `trAuto`, `trConcurrency`, `trTemperature`, `trNoThink`, `trUnit`, `trChunkChars`, `trUseSummary`, `trSummaryModel`, `trProfile`, `trNumCtx` |
| Read aloud | `ttsSource`, `ttsRate`, `ttsAutoScroll`, `ttsVoices` |
| Per-site rules | `siteRules` |

`siteRules[host]` has the shape `{nextSelector, nextText, contentSelector, removeSelector, removeTexts[]}`.

## 4. background.js (service worker)

- **Toolbar action / Alt+R** → `toggleReader(tab)`. It sends `rf-toggle`; if no receiver answers, it injects `CONTENT_FILES`, which auto-open the reader.
- **Context menus:** `rf-open` (page) and `rf-translate-sel` (selection).
  - The selection item uses `sendToFrame(tab, frameId, msg)`. If nothing answers in that frame, it injects with `globalThis.__rfNoAutoOpen = true` first, so the reader does NOT open.
  - Menu titles are re-localized when `uiLang` changes.
- **One-shot messages:**

| Message | What it does |
|---|---|
| `rf-fetch` | Fetch a cross-origin page |
| `rf-render` | Open the URL in an inactive tab, scroll to trigger lazy loading, return the rendered HTML |
| `rf-list-models` | List models on the LLM server |
| `rf-locale` | Return locale JSON to content scripts |
| `rf-fonts` | Return font files as base64 |
| `rf-load-hls` | Inject hls.js into the sender's frame |
| `rf-frame-pip` | Run `installFramePip(url, label)` in all frames; only the frame whose origin+path matches gets a floating ⧉ picture-in-picture button |
| `rf-open-options` | Open the Options page |

- **LLM streaming port `rf-llm`:**
  - Content sends `{type:'translate', id, cfg, messages}` and `{type:'cancel', id}`.
  - The worker replies with `{id, type:'delta'|'done'|'error'}`.
  - `cfg = {provider, endpoint, model, apiKey, noThink, numCtx, sampling}`.
  - Ollama receives `/api/chat` with `options` (sampling plus `num_ctx`) and `think:false`.
  - OpenAI-compatible servers receive `/chat/completions` with the sampling fields merged in.
  - An Ollama 403 produces a hint about `OLLAMA_ORIGINS`.

## 5. content.js — the App

**Open / close**
- `open()` does, in order: load settings, init i18n, `tagLiveVideos()`, clone the live `document` as a snapshot, `buildUI()`, `createSpeaker()`, `startFrom(snapshot, location.href)`.
- `close()` does: dismiss any "view on page" state, `returnBorrowed()`, remove `data-rf-vid`/`data-rf-ifr` tags, destroy speaker/HLS/translator, remove the host.

**Page loop**
- `startFrom()` extracts page 0 from the snapshot. It passes `opts.resourceUrls` (m3u8/mp4 files the page already fetched, from the Performance API, with stream segments filtered out) and `opts.liveBig`.
- `ensureAhead(currentIndex)` and `checkNearBottom()` call `loadNext()`:
  1. fetch the next URL, same-origin in the content script or cross-origin through the worker;
  2. if the text is too short, render it in a background tab;
  3. stop if the content hash was already seen;
  4. `appendPage()`.
- `appendPage()`:
  1. `sanitize(res.html)`;
  2. `setupHls(art)` (HLS videos, plus MP4→HLS fallback through `data-rf-alt-hls`);
  3. remove blocks that repeat earlier pages (series TOCs);
  4. append the section;
  5. then `setupLiveVideos(art)`. This must run after the section is in the DOM, because `moveBefore()` needs both sides connected.

**UI pieces**
- Toolbar: **Listen**, **Translate / Stop translating**, **Settings**, ✕.
- Settings panel:
  - pick the "Next" button (a picker running on the original page);
  - **Hide clutter** (zap mode; the hidden text is saved to `siteRules[host].removeTexts`);
  - display options, UI language, target language.
- Player bar for read-aloud.

**Borrowing the page's own media (page 0 only)**

`tagLiveVideos()`:
- tags every `<video>` with `data-rf-vid=i`, including videos inside open shadow roots; for those, the tag goes on the light-DOM host;
- tags every `<iframe>` with `data-rf-ifr=i`;
- computes `liveBig`: visible videos at least 300×150, largest first.

`extract.js` then copies these tags onto the media HTML it produces:
- `markLive()` adds `data-rf-live`;
- `markLiveFrame()` adds `data-rf-live-frame`, plus `data-rf-controlled` when the iframe is not self-contained, for example BBC SMP `…/iframe.html` with no query or ID, which the parent page drives via `postMessage`.

`setupLiveVideos()` then acts on those tags:
- `.rf-media-missing[data-rf-live]` → `borrow()`: moves the real `<video>` element into the reader. Its MSE `blob:` stream, cookies and DRM keys travel with the element. A MutationObserver falls back to `pipBox()` if the site takes the element back.
- `video[data-rf-live]` whose guessed source fails → `videoFailed()` → `borrow()`.
- `.rf-embed[data-rf-live-frame]` → `borrowFrame()`: moves the live iframe with `Element.moveBefore()` (Chrome 133+, no reload), then asks the worker to install the in-frame ⧉ picture-in-picture button.
- Controlled iframes on pages 2+ → a link to the original page.
- Fallbacks:
  - `pipBox()` offers a **Picture-in-picture** button and **View on the page**;
  - `peek(el)` hides the reader, scrolls to the player and shows "← Back to reader".
- `returnBorrowed()` restores every element to its original position (via marker comments), with its original attributes and style.

## 6. Extraction pipeline (lib/extract.js → `extract(doc, url, opts)`)

1. `prepare()`: sets `<base>`, fixes lazy images (`data-src`, `data-srcset`, …), makes media URLs absolute.
2. **Lead adapters**, run before cleaning because they need `<script>` data. Currently only `substackLead`:
   - reads `window._preloads`: `post.videoUpload.id`, `podcast_url`, `publishedBylines`, `post_date`;
   - falls back to `video[data-video-id]` and then the `og:image` path to find the video ID;
   - video URL: `/api/v1/video/upload/<id>/src?type=mp4`, with `type=hls` as fallback;
   - body selector `.available-content .body.markup`;
   - the transcript is pulled out into a collapsed `<details class="rf-transcript">`, which is never translated or read aloud.
3. `preClean()`: user `removeSelector`, then share widgets (detected by share-URL patterns and share-like class names).
4. `stashMedia()` replaces every media item with a placeholder `<iframe src="https://rf-media.invalid/<i>">`. Readability's `allowedVideoRegex` keeps these, so containers survive `_cleanConditionally`. The media HTML goes into `store[i]`, and `store.anchors[i]` records the nearest text block before and after the placeholder. Sub-steps:
   - **Step 1:** containers with video attributes (`data-vid`, `data-video`, `data-src`, `data-hls`…; the kenh14 `type="VideoStream"` pattern). Domains without a protocol get one added.
   - **Step 1c:** custom-element players: `*-*` tags with an m3u8/mp4 `src`, or with `playback-id` (Mux → `stream.mux.com/<id>.m3u8`).
   - **Step 1b:** elements whose `data-attrs` JSON contains `mediaUploadId` (Substack) or `videoId` (YouTube wrappers).
   - **Step 2:** `picture`, `video`, `audio`, `iframe` and `embed` through `mediaHtml()`:
     - known player frameworks are replaced by their root (`PLAYER_ROOT`);
     - YouTube/Vimeo URLs given as `<source>` become embeds;
     - `blob:` videos are recovered from attributes, then JSON-LD `VideoObject`, then `og:video`, then `resourceUrls`, in that order;
     - Substack `data-video-id` is handled;
     - iframes are kept if they match `EMBED_RE`, or if `isPlayerIframe()` is true (fullscreen/autoplay allowed, and either same site or a player-like URL, and not an ad according to `AD_IFRAME`).
   - **Step 3:** remove leftover player chrome (`PLAYER_CHROME` selectors).
5. **Content selection:** `contentSelector` (site rule or adapter), otherwise Readability, otherwise the image-gallery fallback for manga/albums.
6. `postClean()`: share links, ad labels (`[PR]`, 広告, Quảng cáo…), texts the user hid, leading site/byline/date lines (the date is kept), empty blocks.
7. `cleanTitle()`: strips the "：Site" / " | Site" suffix.
8. `unstash()` puts media back and records which placeholders were used.
9. `reinsertLost()`: media whose placeholder Readability still dropped are re-inserted next to their anchor text.
10. **If the page ends up with no media at all**, use the first of:
    1. the largest live video that has a playable source;
    2. `playerMetaEmbed()` (`og:video` of type text/html, or `twitter:player`, as TED does);
    3. the largest live video without a source (it will be borrowed).
11. Then the Substack lead media, byline and transcript are added.

The function returns `{title, byline, siteName, html, textLength, mediaCount, hash, lang (declared or guessed vi/ja/ko), dir, date}`.

## 7. Translation (lib/translate.js)

- **Unit of work.** `readableBlocks(root)` returns leaf text blocks. It excludes `pre`, `code`, translations, seams, context boxes, site name/byline and the transcript.
- **Serialization.**
  - Each block's inline markup becomes placeholders: `<tN>…</tN>` for inline tags, `<mN></mN>` for media and `<br>`.
  - `rebuild()` recreates the DOM from the translation using only clones of the original nodes, so it is XSS-safe.
- **Whole-page mode** (`trUnit:'page'`):
  - Blocks are wrapped as `<s1>…</s1>\n<s2>…</s2>` and split into chunks of about `trChunkChars` (default 4000).
  - Each later chunk receives the tail of the previous one, source and translation.
  - Segments are parsed while streaming, so the translation fills in paragraph by paragraph.
  - `normalizeTags()` repairs malformed tags such as `[s1>`, `＜s1＞`, `【s1】`.
  - Paragraphs the model skipped are re-translated one by one.
- **Running summary.**
  - `summaryUpTo(i)` builds a cumulative summary of pages 1..i in the target language, with a glossary.
  - It uses `trSummaryModel` if set, otherwise the translation model.
  - It is shown per page as "Context used to translate this page".
- **Profiles.** `profileOf()` detects `hymt`, `tgemma` or `generic` from the model name.
  - Hy-MT and TranslateGemma get a single user message without a system prompt.
  - Hy-MT also gets sampling temperature 0.7, top_p 0.6, top_k 20, repeat_penalty 1.05.
- **Controls.**
  - `start()`, `stop()` (cancels in-flight work but keeps finished paragraphs), `clear()`, `reset()` (called when model, language, profile or unit changes).
  - The **Translate** button toggles `start()`/`stop()`.
  - `trAuto` starts translation when the reader opens.
- **Selection translation.** `quickTranslate(text, settings, ctx, onUpdate)` streams a single segment. `SelectionPopup` in `content.js` places the panel next to the selection, including selections inside the reader's shadow root (via `shadowRoot.getSelection`).

## 8. Testing

```bash
cd reader-flow-dev && npm install          # jsdom + player libraries used by the fixtures
npm run unit                               # jsdom: next-page (12), series (4), dates (10), video extraction, Asahi cleanup
python3 server/server.py &                 # 127.0.0.1:8765: fixtures + mock LLM (/api/chat, /v1/chat/completions)
cd e2e && python3 e2e.py                   # needs: pip install playwright (Chromium with --load-extension)
```

**What the e2e scripts cover**

| Script | Area |
|---|---|
| `e2e.py` | Stitching, media, translation, Shift_JIS, JS rendering |
| `page_tr_test.py` | Whole-page translation, summaries, chunking. Mock model names: `mock`, `slow`, `drop` (skips a segment), `bracket` (writes `[sN>`), `hy-mt*` |
| `vi_test.py` | Vietnamese fonts under a strict CSP, stop/resume |
| `sel_test.py` | Translate selection |
| `tts_test.py` | Read aloud with a mocked speechSynthesis injected into the ISOLATED world |
| `clean_test.py` | Asahi-style cleanup, hide clutter |
| `series_e2e.py` | Medium-style series |
| `picker.py` | Next-button picker |
| `i18n_test.py` | Language switching |
| `auto_test.py` | `trAuto` persistence |
| `video_e2e.py`, `substack_e2e.py [''\|1\|2]`, `sub3.py`, `borrow_test.py`, `smp_test.py`, `vidsites.py <w3 vjs mejs mejs2 vjs10 ted bbc>` | Video cases |

**Testing notes**
- The Chromium build used by Playwright has **no H.264**. Test media are VP9/Opus in MP4 and fMP4 HLS.
- Headless Chromium has **no speech voices**, so TTS is tested with a mock.
- The fixtures reproduce real sites that could not be reached from the dev sandbox: kenh14, Substack, Asahi, Medium, w3schools, MediaElement examples, video.js v10, TED, BBC SMP.

**i18n completeness check:** every `rfT('x')` or `T('x')` key and every `data-i18n` key must exist in all three locales.

## 9. Known limitations / open items (backlog)

**Not yet verified on the real sites:** BBC Learning English, TED, videojs.org, NHK, MediaElement examples. They were only reproduced from fixtures. If one fails, ask the user for the HTML around the player (DevTools → Inspect).

**Known gaps**
- `Esc` does not close the reader while keyboard focus is inside a borrowed iframe.
- Videos on page 2+ cannot be borrowed; they fall back to a link.
- DASH (`.mpd`) is not supported (no dash.js).
- Social embeds (X/Twitter, TikTok, Instagram blockquote + script) are not supported.
- "Load more" buttons without links are not followed.
- DRM video may render black after being moved on some systems; picture-in-picture or "View on the page" is the workaround.

**Offered to the user but not built**
- Refusal detection plus a fallback model when the LLM refuses (e.g. adult content), and a custom-text "Test translation" box in Options.
- A per-site glossary / terminology table fed to Hy-MT's terminology prompt. The automatic glossary inside the running summary already exists.
- **Live audio captions and translation (planned, not started):**
  - Phase 0: translate existing tracks (`<track>`, `hls.subtitleTracks`) into bilingual cues.
  - Phase 1: `chrome.tabCapture` + offscreen document + AudioWorklet (16 kHz PCM) + VAD → local Whisper server (whisper.cpp or Speaches, OpenAI `/v1/audio/transcriptions`) → overlay or `video.addTextTrack()`.
  - Phase 2: sentence merging, contextual translation, transcript panel, SRT export, a filter for Whisper hallucinations on silence.
  - Phase 3: pre-transcribe known source URLs for zero lag.
  - Phase 4: in-browser Whisper with WebGPU.
  - This needs the `tabCapture` and `offscreen` permissions.

## 10. How the owner likes to work

- They report issues by URL or by pasting HTML. They expect a diagnosis of the root cause, a fix, and a reproduction test before the answer.
- Keep fixes generic (patterns, not one-off site hacks) unless a platform adapter is clearly justified, as with Substack.
- Always update the user-facing `README.md` (English) and the locales when behaviour or UI changes.
