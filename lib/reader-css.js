/* CSS cho giao diện đọc, nạp bằng adoptedStyleSheets trong Shadow DOM (không bị CSP của trang chặn). */
globalThis.RF_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }

.rf-root {
  --paper: #F6F7F4; --ink: #22262A; --muted: #697076; --rule: #D8DCD4;
  --accent: #2B5D7C; --accent-soft: rgba(43, 93, 124, .28); --bar: rgba(246, 247, 244, .9);
  --tr-ink: #2F4A5C;
  position: fixed; inset: 0; display: flex; flex-direction: column;
  background: var(--paper); color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", "Noto Sans", sans-serif;
  font-size: 15px; line-height: 1.4; color-scheme: light;
}
.rf-root.theme-sepia {
  --paper: #F3EAD7; --ink: #3A2F22; --muted: #7C6C57; --rule: #DDD0B6;
  --accent: #8A5A2B; --accent-soft: rgba(138, 90, 43, .3); --bar: rgba(243, 234, 215, .92); --tr-ink: #5A4027;
}
.rf-root.theme-dark {
  --paper: #1A1C1E; --ink: #D5D8D2; --muted: #8E948F; --rule: #34383B;
  --accent: #86B4CF; --accent-soft: rgba(134, 180, 207, .3); --bar: rgba(26, 28, 30, .9); --tr-ink: #A9C6D6;
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  .rf-root.theme-auto {
    --paper: #1A1C1E; --ink: #D5D8D2; --muted: #8E948F; --rule: #34383B;
    --accent: #86B4CF; --accent-soft: rgba(134, 180, 207, .3); --bar: rgba(26, 28, 30, .9); --tr-ink: #A9C6D6;
    color-scheme: dark;
  }
}

/* Thanh công cụ */
.rf-bar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 3;
  display: flex; align-items: center; gap: 12px; padding: 8px 14px;
  background: var(--bar); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--rule);
  transition: transform .2s ease;
}
.rf-bar.rf-hidden { transform: translateY(-100%); }
.rf-where { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; overflow: hidden; }
.rf-site { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rf-counter { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.rf-trstat { color: var(--muted); white-space: nowrap; font-size: 13px; }
.rf-trstat.rf-err { color: #B4412F; }
.rf-tools { display: flex; align-items: center; gap: 4px; }
.rf-tools button, .rf-tools select, .rf-panel button, .rf-panel select, .rf-panel input, .rf-status button {
  font: inherit; color: var(--ink); background: transparent; border: 1px solid transparent;
  border-radius: 6px; padding: 5px 9px; cursor: pointer;
}
.rf-tools button:hover, .rf-tools select:hover { border-color: var(--rule); }
.rf-tools select { border-color: var(--rule); }
.rf-tools button[aria-pressed="true"] { background: var(--accent-soft); }
.rf-tools .rf-trbtn { border-color: var(--rule); white-space: nowrap; min-width: 5.5em; }
.rf-tools .rf-trbtn[aria-pressed="true"] { background: var(--accent-soft); }
.rf-tools .rf-trbtn.rf-busy { border-color: var(--accent); }
button:focus-visible, select:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.rf-progress { position: absolute; top: 0; left: 0; height: 2px; background: var(--accent); z-index: 4; width: 0; }

/* Bảng cài đặt nhanh */
.rf-panel {
  position: absolute; top: 52px; right: 12px; z-index: 5; width: min(340px, calc(100vw - 24px));
  background: var(--paper); border: 1px solid var(--rule); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0,0,0,.18); padding: 14px 16px; display: grid; gap: 10px;
}
.rf-panel[hidden] { display: none; }
.rf-panel label { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; font-size: 14px; }
.rf-panel input[type="number"] { width: 76px; border-color: var(--rule); }
.rf-panel input[type="text"] { width: 150px; border-color: var(--rule); }
.rf-panel select { border-color: var(--rule); }
.rf-panel hr { border: 0; border-top: 1px solid var(--rule); margin: 2px 0; width: 100%; }
.rf-panel .rf-row { display: flex; gap: 8px; flex-wrap: wrap; }
.rf-panel .rf-row button { border-color: var(--rule); }
.rf-panel .rf-hint { font-size: 12.5px; color: var(--muted); margin: 0; }

/* Vùng đọc */
.rf-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 72px 20px 40vh; scroll-behavior: auto; }
.rf-content {
  max-width: var(--rf-width, 700px); margin: 0 auto;
  font-family: var(--rf-font); font-size: var(--rf-size, 19px); line-height: var(--rf-lh, 1.7);
  overflow-wrap: break-word; hyphens: auto;
}
/* Font đọc. Chỉ liệt kê những font có đủ dấu tiếng Việt trước phần CJK:
   font thiếu glyph (Charter, Iowan…) khiến trình duyệt ghép chữ từ nhiều font -> dấu lệch, khó đọc. */
.rf-root {
  --cjk-serif: "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP";
  --cjk-sans: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", "Noto Sans CJK JP", "Noto Sans JP";
  --serif-sys: "Noto Serif", "Source Serif 4", "Source Serif Pro", "Times New Roman", "Cambria", Georgia;
  --sans-sys: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial;
}
.rf-root.font-serif        { --rf-font: "RF Literata", var(--serif-sys), var(--cjk-serif), serif; }
.rf-root.font-sans         { --rf-font: "RF Inter", var(--sans-sys), var(--cjk-sans), sans-serif; --rf-lh: 1.65; }
.rf-root.font-system-serif { --rf-font: var(--serif-sys), var(--cjk-serif), serif; }
.rf-root.font-system-sans  { --rf-font: var(--sans-sys), var(--cjk-sans), sans-serif; --rf-lh: 1.65; }
/* Chữ Hán theo đúng vùng để không lấy nhầm tự hình tiếng Nhật */
.rf-content :lang(zh-Hans), .rf-content :lang(zh-CN), .rf-content :lang(zh-SG), .rf-content :lang(zh) {
  font-family: var(--rf-latin, "RF Literata"), "PingFang SC", "Noto Serif SC", "Noto Sans SC", "Songti SC", "Microsoft YaHei", sans-serif; }
.rf-content :lang(zh-Hant), .rf-content :lang(zh-TW), .rf-content :lang(zh-HK) {
  font-family: var(--rf-latin, "RF Literata"), "PingFang TC", "Noto Serif TC", "Noto Sans TC", "Songti TC", "Microsoft JhengHei", sans-serif; }
.rf-content :lang(ko) { font-family: var(--rf-latin, "RF Literata"), "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif; }
.rf-root.font-sans, .rf-root.font-system-sans { --rf-latin: "RF Inter"; }
/* Dấu tiếng Việt chồng lên nhau (Ấ, Ổ, Ữ) cần khoảng thở dọc rộng hơn */
.rf-content :lang(vi) { --rf-head-lh: 1.36; }
.rf-content :is(h1, h2, h3, h4) > .rf-tr:lang(vi) { line-height: 1.36; }

.rf-page + .rf-page { margin-top: 3.5em; }
.rf-page-head { margin-bottom: 1.6em; }
.rf-page-head .rf-sitename { color: var(--muted); font-family: system-ui, sans-serif; font-size: .72em; margin: 0 0 .5em; }
.rf-page-head h1 { font-size: 2em; line-height: var(--rf-head-lh, 1.24); margin: 0 0 .35em; font-weight: 700; letter-spacing: -.01em; }
.rf-page-head .rf-byline { color: var(--muted); font-size: .8em; margin: 0; display: flex; flex-wrap: wrap; gap: .2em 1.2em; }
.rf-zapping .rf-article * { cursor: crosshair; }
.rf-player-open .rf-zap-tip { bottom: 84px; }
.rf-speaking { background: color-mix(in srgb, var(--accent) 11%, transparent); box-shadow: 0 0 0 .35em color-mix(in srgb, var(--accent) 11%, transparent); border-radius: 3px; }
.rf-player {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 5;
  display: flex; align-items: center; gap: 4px; padding: 6px 8px; max-width: calc(100% - 24px);
  background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; box-shadow: 0 10px 28px rgba(0,0,0,.18);
}
.rf-player[hidden] { display: none; }
.rf-player button, .rf-player select { font: inherit; color: var(--ink); background: transparent; border: 1px solid transparent; border-radius: 8px; padding: 5px 9px; cursor: pointer; }
.rf-player select { border-color: var(--rule); max-width: 9em; }
.rf-player button:hover { border-color: var(--rule); }
.rf-player .rf-tts-main { background: var(--accent); color: var(--paper); min-width: 2.6em; }
.rf-tts-stat { font-size: 13px; color: var(--muted); padding: 0 6px; max-width: 18em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rf-tts-stat:empty { display: none; }
.rf-tts-stat.rf-err { color: #B4412F; }
.rf-tools .rf-listen { border-color: var(--rule); }
.rf-tools .rf-listen[aria-pressed="true"] { background: var(--accent-soft); }
.rf-zap-hover { outline: 2px dashed #B4412F; outline-offset: 2px; background: rgba(180, 65, 47, .08) !important; }
.rf-zap-tip {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 6; max-width: min(640px, calc(100% - 24px));
  display: flex; gap: 12px; align-items: center; padding: 10px 12px 10px 16px; border-radius: 10px;
  background: var(--ink); color: var(--paper); font-size: 14px; box-shadow: 0 10px 28px rgba(0,0,0,.25);
}
.rf-zap-tip button { font: inherit; color: var(--ink); background: var(--paper); border: 0; border-radius: 6px; padding: 5px 12px; cursor: pointer; white-space: nowrap; }

/* Đường nối giữa các trang */
.rf-seam {
  display: grid; grid-template-columns: auto 1fr; align-items: end; gap: 0 14px;
  margin: 0 0 1.6em; padding-top: .4em; border-top: 1px solid var(--rule);
  font-family: system-ui, sans-serif;
}
.rf-seam-num { grid-row: span 2; font-size: 3.4em; line-height: .9; font-weight: 250; color: var(--accent); font-variant-numeric: lining-nums; margin-top: .12em; }
.rf-seam-title { font-size: .8em; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rf-seam a { font-size: .68em; color: var(--muted); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rf-seam a:hover { color: var(--accent); text-decoration: underline; }

/* Nội dung bài */
.rf-article h1, .rf-article h2, .rf-article h3, .rf-article h4 { line-height: var(--rf-head-lh, 1.28); margin: 1.5em 0 .5em; }
.rf-article h2 { font-size: 1.45em; } .rf-article h3 { font-size: 1.2em; } .rf-article h4 { font-size: 1.05em; }
.rf-article p, .rf-article ul, .rf-article ol, .rf-article blockquote, .rf-article pre, .rf-article table, .rf-article figure { margin: 0 0 1.1em; }
.rf-article a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
.rf-article img, .rf-article video, .rf-article picture, .rf-article svg { max-width: 100%; height: auto; display: block; margin: 0 auto; border-radius: 3px; }
.rf-article p img { display: inline-block; }
.rf-article figure { margin-left: 0; margin-right: 0; }
.rf-article figcaption { font-size: .8em; color: var(--muted); text-align: center; margin-top: .5em; }
.rf-article audio { width: 100%; display: block; }
.rf-article video { width: 100%; background: #000; }
.rf-article blockquote { border-left: 3px solid var(--rule); padding-left: 1em; color: var(--muted); margin-left: 0; }
.rf-article pre { background: rgba(127,127,127,.1); padding: .9em 1em; border-radius: 6px; overflow-x: auto; font-size: .82em; line-height: 1.5; }
.rf-article code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .88em; }
.rf-article table { border-collapse: collapse; display: block; overflow-x: auto; font-size: .88em; }
.rf-article td, .rf-article th { border: 1px solid var(--rule); padding: .4em .6em; vertical-align: top; }
.rf-article hr { border: 0; border-top: 1px solid var(--rule); margin: 2em 0; }
.rf-embed { position: relative; width: 100%; height: 0; padding-top: 56.25%; }
.rf-embed iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 4px; }
.rf-transcript { margin: 2em 0; border-top: 1px solid var(--rule); padding-top: 1em; font-size: .92em; }
.rf-transcript > summary { cursor: pointer; font-family: system-ui, sans-serif; font-size: .8em; color: var(--muted); }
.rf-transcript[open] > summary { margin-bottom: 1em; }
.rf-borrowed { margin: 0 0 1.1em; }
.rf-borrowed-tools { display: flex; gap: 12px; align-items: center; justify-content: flex-end; margin-top: 6px; font-family: system-ui, sans-serif; font-size: 12.5px; }
.rf-borrowed-tools a { color: var(--muted); }
.rf-media-missing button, .rf-borrowed-tools button { font: inherit; font-size: 13px; color: var(--ink); background: transparent; border: 1px solid var(--rule); border-radius: 6px; padding: 4px 10px; cursor: pointer; margin: 0 8px 6px 0; }
.rf-media-missing { border: 1px dashed var(--rule); border-radius: 6px; padding: .8em; text-align: center; font-size: .85em; }
.rf-media-missing img { margin-bottom: .6em; opacity: .85; }

/* Bản dịch */
.rf-tr { display: none; }
.rf-root[data-tr="bilingual"] .rf-has-tr > .rf-tr {
  display: block; margin-top: .35em; padding-left: 14px; border-left: 3px solid var(--accent-soft); color: var(--tr-ink);
}
.rf-root[data-tr="bilingual"] .rf-tr-media { display: none; }
.rf-root[data-tr="replace"] .rf-has-tr > .rf-tr { display: inline; }
.rf-root[data-tr="replace"] .rf-has-tr > .rf-orig { display: none; }
.rf-root[data-tr="replace"] .rf-has-tr > .rf-tr-pending:empty + .rf-orig,
.rf-root[data-tr="replace"] .rf-has-tr:has(> .rf-tr-pending:empty) > .rf-orig { display: inline; opacity: .45; }
.rf-tr-pending:empty::before { content: var(--rf-l-translating, "…"); color: var(--muted); font-size: .8em; }
.rf-tr-pending:not(:empty)::after { content: "▍"; color: var(--accent); animation: rf-blink 1s steps(2) infinite; }
.rf-tr-error { color: #B4412F !important; font-size: .82em; }
.rf-ctx { margin: 0 0 1.4em; font-family: system-ui, sans-serif; font-size: 13px; color: var(--muted); }
.rf-ctx summary { cursor: pointer; width: fit-content; }
.rf-ctx div { white-space: pre-wrap; margin-top: .5em; padding: .7em .9em; border: 1px solid var(--rule); border-radius: 6px; line-height: 1.55; }
.rf-root[data-tr="off"] .rf-ctx { display: none; }
.rf-sec-waiting .rf-seam-num { opacity: .5; }
.rf-retry { font: inherit; border: 1px solid currentColor !important; border-radius: 5px; padding: 1px 7px; background: none; color: inherit; cursor: pointer; }
@keyframes rf-blink { 50% { opacity: 0; } }

/* Trạng thái cuối danh sách */
.rf-status {
  max-width: var(--rf-width, 700px); margin: 3em auto 0; text-align: center; color: var(--muted);
  font-size: 14px; display: grid; gap: 10px; justify-items: center;
}
.rf-status button { border: 1px solid var(--rule) !important; }
.rf-status .rf-loading::before {
  content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 8px; border-radius: 50%;
  border: 2px solid var(--accent); border-right-color: transparent; animation: rf-spin .8s linear infinite; vertical-align: -1px;
}
@keyframes rf-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .rf-scroll { padding: 64px 16px 40vh; }
  .rf-counter { display: none; }
  .rf-tools button.rf-opt { display: none; }
  .rf-player select:last-of-type { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .rf-bar { transition: none; }
  .rf-status .rf-loading::before, .rf-tr-pending:not(:empty)::after { animation: none; }
}
`;

globalThis.RF_SEL_CSS = `
:host { all: initial; }
.box {
  --paper: #F6F7F4; --ink: #22262A; --muted: #697076; --rule: #D8DCD4; --accent: #2B5D7C;
  position: fixed; box-sizing: border-box; max-height: min(60vh, 520px); overflow: auto;
  background: var(--paper); color: var(--ink); border: 1px solid var(--rule); border-radius: 10px;
  box-shadow: 0 14px 40px rgba(0,0,0,.22); padding: 10px 14px 14px;
  font: 15px/1.6 "RF Literata", "Noto Serif", "Times New Roman", Georgia, "Hiragino Mincho ProN", serif;
  color-scheme: light;
}
.box.theme-sepia { --paper: #F3EAD7; --ink: #3A2F22; --muted: #7C6C57; --rule: #DDD0B6; --accent: #8A5A2B; }
.box.theme-dark { --paper: #1A1C1E; --ink: #D5D8D2; --muted: #8E948F; --rule: #34383B; --accent: #86B4CF; color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  .box.theme-auto { --paper: #1A1C1E; --ink: #D5D8D2; --muted: #8E948F; --rule: #34383B; --accent: #86B4CF; color-scheme: dark; }
}
.head { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
.title { flex: 1; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: transparent;
  border: 1px solid var(--rule); border-radius: 6px; padding: 3px 9px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.x { border-color: transparent; }
.src { color: var(--muted); font-size: 13px; line-height: 1.5; border-left: 3px solid var(--rule); padding-left: 10px; margin-bottom: 10px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
.out { white-space: pre-wrap; overflow-wrap: break-word; }
.out.pending:empty::before { content: "…"; color: var(--muted); }
.out.pending:not(:empty)::after { content: "▍"; color: var(--accent); }
.out.err { color: #B4412F; font-size: 14px; }
`;
