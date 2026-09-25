/* Reader Flow — service worker */
importScripts('lib/settings.js', 'lib/i18n.js', 'lib/fetch-util.js');

let i18nReady = rfLoadSettings().then((s) => rfInitI18n(s.uiLang));
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.uiLang) {
    i18nReady = rfInitI18n(ch.uiLang.newValue).then(updateMenu);
  }
});
function updateMenu() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.update('rf-open', { title: rfT('ctxOpen') }, () => void chrome.runtime.lastError);
  chrome.contextMenus.update('rf-translate-sel', { title: rfT('ctxTranslateSel') }, () => void chrome.runtime.lastError);
}

const CONTENT_FILES = [
  'lib/Readability.js', 'lib/settings.js', 'lib/i18n.js', 'lib/fetch-util.js', 'lib/nextpage.js',
  'lib/extract.js', 'lib/translate.js', 'lib/tts.js', 'lib/fonts.js', 'lib/reader-css.js', 'content.js'
];

async function toggleReader(tab) {
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'rf-toggle' });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    } catch (err) {
      console.warn('[Reader Flow] Cannot inject into this page:', err.message);
    }
  }
}

chrome.action.onClicked.addListener(toggleReader);

/* Gửi tin nhắn tới đúng khung (frame) đang có vùng chọn; chưa có content script thì chèn vào
 * nhưng không tự mở chế độ đọc. */
async function sendToFrame(tab, frameId, msg) {
  const opts = { frameId: frameId || 0 };
  try {
    await chrome.tabs.sendMessage(tab.id, msg, opts);
  } catch (e) {
    const target = { tabId: tab.id, frameIds: [frameId || 0] };
    await chrome.scripting.executeScript({ target, func: () => { globalThis.__rfNoAutoOpen = true; } });
    await chrome.scripting.executeScript({ target, files: CONTENT_FILES });
    await chrome.tabs.sendMessage(tab.id, msg, opts);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await i18nReady;
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'rf-open', title: rfT('ctxOpen'), contexts: ['page'] }, () => void chrome.runtime.lastError);
    chrome.contextMenus.create({ id: 'rf-translate-sel', title: rfT('ctxTranslateSel'), contexts: ['selection'] }, () => void chrome.runtime.lastError);
  });
});
if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab) return;
    if (info.menuItemId === 'rf-open') toggleReader(tab);
    if (info.menuItemId === 'rf-translate-sel') {
      sendToFrame(tab, info.frameId, { type: 'rf-translate-selection', text: info.selectionText || '' })
        .catch((e) => console.warn('[Reader Flow] Cannot translate selection here:', e.message));
    }
  });
}

/* ---------- Tải trang qua service worker (khác origin) và render JS trong tab nền ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitTabComplete(tabId, timeout) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(t); fn(v); };
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') finish(resolve); };
    const t = setTimeout(() => finish(reject, new Error(rfT('errTabTimeout'))), timeout);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') finish(resolve); }).catch((e) => finish(reject, e));
  });
}

async function renderInTab(url, waitMs) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitTabComplete(tab.id, 30000);
    await sleep(Math.max(0, +waitMs || 0));
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        // Cuộn dần xuống để kích hoạt ảnh lazy-load
        const H = () => document.documentElement.scrollHeight;
        for (let i = 1; i <= 8; i++) { window.scrollTo(0, (H() * i) / 8); await new Promise((r) => setTimeout(r, 200)); }
        window.scrollTo(0, 0);
        return { html: '<!DOCTYPE html>' + document.documentElement.outerHTML, finalUrl: location.href };
      }
    });
    if (!res || !res.result) throw new Error(rfT('errTabRead'));
    return res.result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function toB64(buf) {
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* Chạy trong từng khung của tab; chỉ khung có địa chỉ trùng iframe player mới gắn nút. */
function installFramePip(url, label) {
  if (window === window.top || window.__rfPipBtn) return;
  const key = (u) => { try { const x = new URL(u, location.href); return x.origin + x.pathname; } catch (e) { return u; } };
  if (key(location.href) !== key(url)) return;
  const videos = () => {
    const out = [];
    const walk = (root) => { root.querySelectorAll('video').forEach((v) => out.push(v)); root.querySelectorAll('*').forEach((el) => el.shadowRoot && walk(el.shadowRoot)); };
    walk(document);
    return out.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  };
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:8px;right:8px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const btn = document.createElement('button');
  btn.textContent = '⧉';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.style.cssText = 'font:16px/1 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.5);' +
    'border-radius:6px;padding:6px 8px;cursor:pointer;opacity:.75;';
  btn.onmouseenter = () => { btn.style.opacity = '1'; };
  btn.onmouseleave = () => { btn.style.opacity = '.75'; };
  btn.onclick = async (e) => {
    e.stopPropagation();
    try {
      if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return; }
      const v = videos()[0];
      if (!v) throw new Error('no video');
      await v.requestPictureInPicture();
      if (v.paused) v.play().catch(() => {});
    } catch (err) { btn.title = label + ' — ' + err.message; btn.style.background = 'rgba(180,65,47,.8)'; }
  };
  root.append(btn);
  (document.body || document.documentElement).append(host);
  window.__rfPipBtn = host;
}

/* ---------- LLM ---------- */

function trimSlash(s) { return (s || '').replace(/\/+$/, ''); }

async function listModels(cfg) {
  const base = trimSlash(cfg.endpoint);
  if (cfg.provider === 'ollama') {
    const r = await fetch(base + '/api/tags');
    if (!r.ok) throw new Error(r.status === 403 ? rfT('errOllama403') : rfT('errHttp', r.status));
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  }
  const r = await fetch(base + '/models', { headers: cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {} });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j.data || []).map((m) => m.id);
}

async function readLines(body, onLine, signal) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal.aborted) { reader.cancel().catch(() => {}); return; }
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line && onLine(line) === false) { reader.cancel().catch(() => {}); return; }
    }
  }
  if (buf.trim()) onLine(buf.trim());
}

async function streamChat(cfg, messages, signal, onDelta) {
  const base = trimSlash(cfg.endpoint);
  let res;
  if (cfg.provider === 'ollama') {
    const samp = cfg.sampling || { temperature: cfg.temperature };
    const options = Object.assign({}, samp);
    if (cfg.numCtx) options.num_ctx = cfg.numCtx; // mặc định của Ollama quá nhỏ cho dịch cả trang
    const body = { model: cfg.model, messages, stream: true, keep_alive: '15m', options };
    if (cfg.noThink) body.think = false;
    res = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  } else {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
    res = await fetch(base + '/chat/completions', {
      method: 'POST', headers, signal,
      // llama-server nhận thêm top_k, repeat_penalty; máy chủ khác sẽ bỏ qua
      body: JSON.stringify(Object.assign({ model: cfg.model, messages, stream: true }, cfg.sampling || { temperature: cfg.temperature }))
    });
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (e) { /* bỏ qua */ }
    if (res.status === 403 && cfg.provider === 'ollama') throw new Error(rfT('errOllama403'));
    throw new Error('HTTP ' + res.status + (detail ? ': ' + detail : ''));
  }
  await readLines(res.body, (line) => {
    if (cfg.provider === 'ollama') {
      const j = JSON.parse(line);
      if (j.error) throw new Error(j.error);
      if (j.message && j.message.content) onDelta(j.message.content);
      if (j.done) return false;
    } else {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return false;
      const j = JSON.parse(data);
      if (j.error) throw new Error(j.error.message || String(j.error));
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (d && d.content) onDelta(d.content);
    }
  }, signal);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'rf-llm') return;
  const ctrls = new Map();
  let alive = true;
  const send = (m) => { if (alive) try { port.postMessage(m); } catch (e) { alive = false; } };
  port.onDisconnect.addListener(() => { alive = false; for (const c of ctrls.values()) c.abort(); ctrls.clear(); });
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'cancel') { const c = ctrls.get(msg.id); if (c) c.abort(); ctrls.delete(msg.id); return; }
    if (msg.type !== 'translate') return;
    const ac = new AbortController();
    ctrls.set(msg.id, ac);
    await i18nReady;
    try {
      await streamChat(msg.cfg, msg.messages, ac.signal, (text) => send({ id: msg.id, type: 'delta', text }));
      if (!ac.signal.aborted) send({ id: msg.id, type: 'done' });
    } catch (e) {
      if (!ac.signal.aborted) {
        const m = e && e.message ? e.message : String(e);
        send({ id: msg.id, type: 'error', error: /Failed to fetch/i.test(m) ? rfT('errConnect', msg.cfg.endpoint) : m });
      }
    } finally {
      ctrls.delete(msg.id);
    }
  });
});

/* ---------- Tin nhắn một lần ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = (fn) => {
    i18nReady.then(fn).then((r) => sendResponse({ ok: true, ...r }), (e) => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }));
    return true;
  };
  switch (msg && msg.type) {
    case 'rf-fetch': return reply(() => rfFetchHtml(msg.url));
    case 'rf-render': return reply(() => renderInTab(msg.url, msg.waitMs));
    case 'rf-list-models': return reply(() => listModels(msg.cfg).then((models) => ({ models })));
    case 'rf-locale':
      // Không chờ i18nReady ở đây: rfInitI18n của chính service worker cũng có thể gọi tới
      fetch(chrome.runtime.getURL('_locales/' + (RF_LOCALES.includes(msg.lang) ? msg.lang : 'en') + '/messages.json'))
        .then((r) => r.json()).then((json) => sendResponse({ ok: true, json }), (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case 'rf-fonts':
      Promise.all((msg.paths || []).map(async (p) => {
        if (!/^fonts\/[\w-]+\.woff2$/.test(p)) throw new Error('bad font path');
        return toB64(new Uint8Array(await (await fetch(chrome.runtime.getURL(p))).arrayBuffer()));
      })).then((data) => sendResponse({ ok: true, data }), (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case 'rf-frame-pip':
      // Nút cửa sổ nổi đặt NGAY TRONG iframe player (vd. BBC): cú bấm phải xảy ra trong chính khung đó
      chrome.scripting.executeScript({ target: { tabId: sender.tab.id, allFrames: true }, func: installFramePip, args: [msg.url, msg.label] })
        .then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case 'rf-load-hls':
      // Chỉ nạp hls.js (≈380KB) khi trang thật sự có video HLS
      chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, files: ['lib/hls.light.min.js'] })
        .then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case 'rf-open-options': chrome.runtime.openOptionsPage(); return false;
    default: return false;
  }
});
