/* Reader Flow — i18n.
 * Nguồn chuỗi duy nhất là _locales/<lang>/messages.json (cũng dùng cho manifest).
 * Không dùng thẳng chrome.i18n.getMessage vì API đó không cho đổi ngôn ngữ trong tiện ích. */
var RF_LOCALES = ['en', 'vi', 'ja'];
var RF_LOCALE_NAMES = { en: 'English', vi: 'Tiếng Việt', ja: '日本語' };
// Ngôn ngữ đích mặc định cho bản dịch LLM, suy ra từ ngôn ngữ giao diện
var RF_LOCALE_TARGET = { en: 'English', vi: 'Vietnamese', ja: 'Japanese' };

var rfI18n = globalThis.rfI18n || { lang: 'en', dict: {}, fallback: {}, cache: {} };
globalThis.rfI18n = rfI18n;

function rfBrowserLang() {
  const ui = ((chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || 'en').toLowerCase();
  const base = ui.split(/[-_]/)[0];
  return RF_LOCALES.includes(base) ? base : 'en';
}

function rfResolveLang(pref) {
  return pref && pref !== 'auto' && RF_LOCALES.includes(pref) ? pref : rfBrowserLang();
}

async function rfLoadDict(lang) {
  if (rfI18n.cache[lang]) return rfI18n.cache[lang];
  let json = {};
  if (location.protocol === 'chrome-extension:') {
    // Service worker và trang tuỳ chọn đọc trực tiếp file của tiện ích
    const r = await fetch(chrome.runtime.getURL('_locales/' + lang + '/messages.json'));
    json = await r.json();
  } else {
    // Content script: nhờ service worker đọc hộ (không cần web_accessible_resources)
    const r = await chrome.runtime.sendMessage({ type: 'rf-locale', lang });
    json = r && r.ok ? r.json : {};
  }
  const out = {};
  for (const [k, v] of Object.entries(json)) out[k] = v.message;
  rfI18n.cache[lang] = out;
  return out;
}

async function rfInitI18n(pref) {
  const lang = rfResolveLang(pref);
  try {
    rfI18n.fallback = await rfLoadDict('en');
    rfI18n.dict = lang === 'en' ? rfI18n.fallback : await rfLoadDict(lang);
    rfI18n.lang = lang;
  } catch (e) {
    console.warn('[Reader Flow] i18n:', e);
  }
  return rfI18n.lang;
}

/* rfT('pageN', 3) -> "Trang 3". Tham số chèn vào {1}, {2}… */
function rfT(key, ...subs) {
  const s = rfI18n.dict[key] != null ? rfI18n.dict[key] : rfI18n.fallback[key] != null ? rfI18n.fallback[key] : key;
  return s.replace(/\{(\d)\}/g, (m, i) => (subs[+i - 1] != null ? String(subs[+i - 1]) : ''));
}

/* Gắn chuỗi cho HTML tĩnh: data-i18n, data-i18n-html, data-i18n-title, data-i18n-placeholder, data-i18n-aria */
function rfApplyI18n(root) {
  root = root || document;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = rfT(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = rfT(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = rfT(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = rfT(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', rfT(el.dataset.i18nAria));
  if (root === document) document.documentElement.lang = rfI18n.lang;
}
