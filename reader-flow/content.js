/* Reader Flow — giao diện đọc, nối trang dần theo tiến độ đọc. */
(() => {
  if (globalThis.__rf && typeof globalThis.__rf.destroy === 'function') {
    try { globalThis.__rf.destroy(); } catch (e) { /* phiên bản cũ đã mất ngữ cảnh */ }
  }

  const THEMES = ['auto', 'light', 'sepia', 'dark'];
  const THEME_LABEL = () => ({ auto: rfT('themeAuto'), light: rfT('themeLight'), sepia: rfT('themeSepia'), dark: rfT('themeDark') });
  const DISPLAY_LABEL = () => ({ bilingual: rfT('trBilingual'), replace: rfT('trReplace') });
  const HOST_TAG = 'rf-reader-host';
  const SEL_TAG = 'rf-sel-host';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) el.append(k);
    return el;
  }

  /* ---------- Làm sạch HTML trích xuất ---------- */
  const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'OBJECT', 'APPLET', 'NOSCRIPT', 'TEMPLATE', 'FRAME', 'FRAMESET', 'DIALOG']);
  const KEEP_ATTRS = new Set(['href', 'src', 'srcset', 'sizes', 'alt', 'title', 'poster', 'controls', 'width', 'height', 'colspan', 'rowspan', 'datetime', 'lang', 'dir', 'type', 'allow', 'allowfullscreen', 'loading', 'start', 'reversed', 'cite', 'preload', 'kind', 'srclang', 'label', 'referrerpolicy', 'media', 'class', 'data-rf-ratio', 'data-rf-hls', 'data-rf-alt-hls', 'data-rf-live', 'data-rf-live-frame', 'data-rf-controlled', 'viewbox', 'd', 'fill', 'stroke', 'xmlns']);
  const KEEP_CLASSES = /^(rf-embed|rf-media|rf-media-missing|rf-transcript)$/;

  function sanitize(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
    const drop = [];
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (DROP_TAGS.has(el.tagName)) { drop.push(el); continue; }
      // iframe: chỉ https (trang http thì cho cả http, như chính trang đó vẫn làm)
      if (el.tagName === 'IFRAME' && !(location.protocol === 'http:' ? /^https?:\/\//i : /^https:\/\//i).test(el.getAttribute('src') || '')) { drop.push(el); continue; }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (!KEEP_ATTRS.has(n)) { el.removeAttribute(a.name); continue; }
        if ((n === 'href' || n === 'src' || n === 'poster' || n === 'cite') && /^\s*(javascript|vbscript):/i.test(a.value)) el.removeAttribute(a.name);
        if (n === 'src' && /^\s*data:/i.test(a.value) && el.tagName !== 'IMG' && el.tagName !== 'SOURCE') el.removeAttribute(a.name);
        if (n === 'class') {
          const keep = a.value.split(/\s+/).filter((c) => KEEP_CLASSES.test(c));
          if (keep.length) el.setAttribute('class', keep.join(' ')); else el.removeAttribute('class');
        }
      }
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      if (el.tagName === 'IMG') { el.setAttribute('loading', 'lazy'); el.setAttribute('decoding', 'async'); }
      if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') el.setAttribute('controls', '');
      if (el.classList && el.classList.contains('rf-embed')) {
        const r = parseFloat(el.getAttribute('data-rf-ratio'));
        if (r > 10 && r < 200) el.style.paddingTop = r + '%';
      }
    }
    drop.forEach((d) => d.remove());
    return tpl.content;
  }

  function prettyUrl(u) {
    try { const x = new URL(u); return decodeURI(x.host + x.pathname + x.search); } catch (e) { return u; }
  }

  /* ---------- Ứng dụng ---------- */
  class App {
    constructor() {
      this.alive = true;
      this.onKey = this.onKey.bind(this);
      this.onScroll = this.onScroll.bind(this);
      this.onStorage = this.onStorage.bind(this);
      this.onMessage = this.onMessage.bind(this);
      chrome.runtime.onMessage.addListener(this.onMessage);
      chrome.storage.onChanged.addListener(this.onStorage);
    }

    onMessage(msg, sender, sendResponse) {
      if (msg && msg.type === 'rf-toggle') { this.toggle(); sendResponse({ ok: true }); }
      if (msg && msg.type === 'rf-translate-selection') { this.translateSelection(msg.text); sendResponse({ ok: true }); }
    }

    get host() { return location.hostname.replace(/^www\./, ''); }
    get rule() { return (this.s.siteRules || {})[this.host] || null; }

    async toggle() {
      if (this.opened) this.close(); else await this.open();
    }

    async open() {
      if (this.opened) return;
      this.opened = true;
      this.s = await rfLoadSettings();
      await rfInitI18n(this.s.uiLang);
      this.tagLiveVideos();
      const snapshot = document.cloneNode(true);
      snapshot.querySelectorAll(HOST_TAG + ',' + SEL_TAG).forEach((e) => e.remove());
      this.buildUI();
      this.createSpeaker();
      this.prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      document.addEventListener('keydown', this.onKey, true);
      await this.startFrom(snapshot, location.href);
    }

    close() {
      if (!this.opened) return;
      this.opened = false;
      if (this.peekBack) { this.peekBack(); this.peekBack = null; }
      this.returnBorrowed();
      document.querySelectorAll('[data-rf-vid], [data-rf-ifr]').forEach((v) => { v.removeAttribute('data-rf-vid'); v.removeAttribute('data-rf-ifr'); });
      this.stopPicker && this.stopPicker();
      this.stopZap();
      if (this.speaker) this.speaker.destroy();
      this.speaker = null;
      (this.hlsList || []).forEach((x) => { try { x.destroy(); } catch (e) { /* bỏ qua */ } });
      this.hlsList = [];
      if (this.hlsIO) { this.hlsIO.disconnect(); this.hlsIO = null; }
      this.playerOpen = false;
      if (this.translator) this.translator.destroy();
      this.translator = null;
      document.removeEventListener('keydown', this.onKey, true);
      document.documentElement.style.overflow = this.prevOverflow || '';
      if (this.hostEl) this.hostEl.remove();
      this.hostEl = null;
      this.runId = (this.runId || 0) + 1;
    }

    destroy() {
      this.close();
      this.alive = false;
      try { chrome.runtime.onMessage.removeListener(this.onMessage); } catch (e) { /* ngữ cảnh cũ */ }
      try { chrome.storage.onChanged.removeListener(this.onStorage); } catch (e) { /* ngữ cảnh cũ */ }
    }

    /* ---- Giao diện ---- */
    buildUI() {
      this.hostEl = h(HOST_TAG);
      this.hostEl.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;';
      const root = this.hostEl.attachShadow({ mode: 'open' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(globalThis.RF_CSS);
      root.adoptedStyleSheets = [sheet];

      this.el = {};
      const E = this.el;
      E.progress = h('div', { class: 'rf-progress' });
      E.site = h('span', { class: 'rf-site' }, this.host);
      E.counter = h('span', { class: 'rf-counter' });
      E.bar = this.buildBar();
      E.panel = this.buildPanel();
      E.content = h('div', { class: 'rf-content' });
      E.status = h('div', { class: 'rf-status', 'aria-live': 'polite' });
      E.scroll = h('main', { class: 'rf-scroll' }, E.content, E.status);
      E.scroll.addEventListener('scroll', this.onScroll, { passive: true });
      E.player = this.buildPlayer();
      E.root = h('div', { class: 'rf-root' }, E.progress, E.bar, E.panel, E.scroll, E.player);
      root.append(E.root);
      document.documentElement.append(this.hostEl);
      this.applyLook();
      E.scroll.tabIndex = -1;
      E.scroll.focus({ preventScroll: true });
    }

    buildBar() {
      const E = this.el;
      E.trstat = h('span', { class: 'rf-trstat', role: 'status' });
      E.listenBtn = h('button', { class: 'rf-listen', 'aria-pressed': String(!!this.playerOpen), onclick: () => this.toggleListen() }, rfT('ttsListen'));
      E.trBtn = h('button', { class: 'rf-trbtn', 'aria-pressed': 'false', onclick: () => this.toggleTranslate() }, rfT('trStart'));
      E.panelBtn = h('button', { class: 'rf-opt', title: rfT('settings'), 'aria-label': rfT('settings'), 'aria-pressed': 'false', onclick: () => this.togglePanel() }, rfT('settings'));
      return h('header', { class: 'rf-bar' },
        h('div', { class: 'rf-where' }, E.site, E.counter, E.trstat),
        h('div', { class: 'rf-tools' },
          h('button', { class: 'rf-opt', title: rfT('fontSmaller'), 'aria-label': rfT('fontSmaller'), onclick: () => this.bump('fontSize', -1, 13, 32) }, 'A−'),
          h('button', { class: 'rf-opt', title: rfT('fontLarger'), 'aria-label': rfT('fontLarger'), onclick: () => this.bump('fontSize', 1, 13, 32) }, 'A+'),
          E.listenBtn, E.trBtn, E.panelBtn,
          h('button', { title: rfT('closeTitle'), 'aria-label': rfT('closeLabel'), onclick: () => this.close() }, '✕')));
    }

    /* Đổi ngôn ngữ giao diện khi đang mở: dựng lại thanh công cụ, bảng cài đặt và các nhãn đã hiển thị. */
    async relabel() {
      await rfInitI18n(this.s.uiLang);
      if (!this.opened || !this.el) return;
      const E = this.el;
      const panelOpen = !E.panel.hidden;
      const bar = this.buildBar(), panel = this.buildPanel(), player = this.buildPlayer();
      E.bar.replaceWith(bar); E.panel.replaceWith(panel); E.player.replaceWith(player);
      E.bar = bar; E.panel = panel; E.player = player;
      if (this.lastTts) this.showTts(this.lastTts);
      if (panelOpen) this.togglePanel(true);
      for (const seam of E.content.querySelectorAll('.rf-seam')) {
        const n = seam.dataset.n;
        seam.setAttribute('aria-label', rfT('pageN', n));
        const t = seam.querySelector('.rf-seam-title');
        if (t.dataset.generic) t.textContent = rfT('pageN', n);
        seam.querySelector('a').title = rfT('openOriginal');
      }
      this.applyLook();
      this.updateCounter();
      if (this.lastStatus) this.setStatus(...this.lastStatus); else this.idleStatus();
      if (this.translator) this.translator.status();
    }

    buildPanel() {
      const s = this.s;
      const ctrls = this.panelCtrls = {};
      const num = (key, min, max, label) => h('label', {}, label,
        ctrls[key] = h('input', { type: 'number', min, max, value: s[key], onchange: (e) => {
          const v = Math.max(min, Math.min(max, Math.round(+e.target.value || min)));
          e.target.value = v; this.save({ [key]: v });
        } }));
      const sel = (key, opts, label) => {
        const el = h('select', { onchange: (e) => this.save({ [key]: e.target.value }) }, ...Object.entries(opts).map(([v, l]) => h('option', { value: v }, l)));
        el.value = s[key];
        ctrls[key] = el;
        return h('label', {}, label, el);
      };
      const lang = ctrls.trTargetLang = h('input', { type: 'text', value: s.trTargetLang, list: 'rf-langs', onchange: (e) => this.save({ trTargetLang: e.target.value.trim() || RF_LOCALE_TARGET[rfI18n.lang] }) });
      const langs = h('datalist', { id: 'rf-langs' }, ...['Vietnamese', 'English', 'Japanese', 'Simplified Chinese', 'Traditional Chinese', 'Korean', 'French', 'German', 'Spanish', 'Thai', 'Indonesian'].map((l) => h('option', { value: l })));
      this.el.ruleNote = h('p', { class: 'rf-hint' });
      const panel = h('div', { class: 'rf-panel', hidden: true, role: 'dialog', 'aria-label': rfT('panelLabel') },
        num('maxPages', 1, 200, rfT('maxPages')),
        num('prefetchAhead', 0, 5, rfT('prefetchAhead')),
        h('p', { class: 'rf-hint' }, rfT('prefetchHint')),
        h('hr'),
        sel('theme', THEME_LABEL(), rfT('theme')),
        sel('trDisplay', DISPLAY_LABEL(), rfT('trDisplay')),
        sel('fontFamily', { serif: rfT('fontSerif'), sans: rfT('fontSans'), 'system-serif': rfT('fontSystemSerif'), 'system-sans': rfT('fontSystemSans') }, rfT('fontFamily')),
        num('lineWidth', 480, 1200, rfT('lineWidth')),
        sel('uiLang', Object.assign({ auto: rfT('uiLangAuto') }, RF_LOCALE_NAMES), rfT('uiLanguage')),
        h('hr'),
        h('label', {}, rfT('translateTo'), lang), langs,
        this.el.modelNote = h('p', { class: 'rf-hint' }),
        h('hr'),
        this.el.ruleNote,
        h('div', { class: 'rf-row' },
          h('button', { onclick: () => this.startPicker() }, rfT('pickNext')),
          h('button', { onclick: () => this.startZap() }, rfT('zapStart')),
          h('button', { onclick: () => this.clearRule() }, rfT('clearRule')),
          h('button', { onclick: () => { if (this.translator) this.translator.clear(); this.trStopped = false; } }, rfT('trClear')),
          h('button', { onclick: () => chrome.runtime.sendMessage({ type: 'rf-open-options' }) }, rfT('moreOptions'))));
      this.updateRuleNote();
      return panel;
    }

    updateRuleNote() {
      if (!this.el || !this.el.ruleNote) return;
      const r = this.rule;
      const parts = [];
      if (r && (r.nextSelector || r.nextText)) parts.push(r.nextText ? rfT('ruleActiveText', this.host, r.nextText) : rfT('ruleActive', this.host));
      else parts.push(rfT('ruleNone'));
      if (r && r.removeTexts && r.removeTexts.length) parts.push(rfT('ruleHidden', r.removeTexts.length));
      this.el.ruleNote.textContent = parts.join(' ');
    }

    togglePanel(force) {
      const p = this.el.panel;
      const show = force != null ? force : p.hidden;
      p.hidden = !show;
      if (show) this.el.bar.classList.remove('rf-hidden');
      this.el.panelBtn.setAttribute('aria-pressed', String(show));
    }

    applyLook() {
      const s = this.s, E = this.el;
      if (!E) return;
      const font = ['serif', 'sans', 'system-serif', 'system-sans'].includes(s.fontFamily) ? s.fontFamily : 'serif';
      E.root.className = 'rf-root theme-' + (THEMES.includes(s.theme) ? s.theme : 'auto') + ' font-' + font +
        (this.playerOpen ? ' rf-player-open' : '') + (this.zapping ? ' rf-zapping' : '');
      if (font === 'serif' || font === 'sans') RFFonts.ensure(font);
      E.root.dataset.tr = s.trDisplay === 'replace' ? 'replace' : 'bilingual';
      E.root.style.setProperty('--rf-size', s.fontSize + 'px');
      E.root.style.setProperty('--rf-width', s.lineWidth + 'px');
      E.root.style.setProperty('--rf-lh', s.lineHeight);
      for (const [k, el] of Object.entries(this.panelCtrls || {})) if (el !== (E.root.getRootNode().activeElement)) el.value = s[k];
      if (E.modelNote) E.modelNote.textContent = rfT('modelNote', s.trModel, s.trProvider === 'ollama' ? 'Ollama' : 'OpenAI API');
      E.root.style.setProperty('--rf-l-translating', JSON.stringify(rfT('trTranslating')));
      E.root.lang = rfI18n.lang;
    }

    async save(patch) {
      const prev = { ...this.s };
      Object.assign(this.s, patch);
      this.afterChange(prev);
      await rfSaveSettings(patch);
    }

    bump(key, d, min, max) { this.save({ [key]: Math.max(min, Math.min(max, (+this.s[key] || 0) + d)) }); }

    onStorage(changes, area) {
      if (area !== 'local' || !this.opened || !this.s) return;
      const prev = { ...this.s };
      for (const [k, v] of Object.entries(changes)) this.s[k] = v.newValue === undefined ? RF_DEFAULTS[k] : v.newValue;
      if (!this.s.trTargetLang) this.s.trTargetLang = RF_LOCALE_TARGET[rfResolveLang(this.s.uiLang)] || 'English';
      this.afterChange(prev);
    }

    /* Dùng chung cho thay đổi từ bảng cài đặt và từ trang Tuỳ chọn */
    afterChange(prev) {
      const changed = (k) => prev[k] !== this.s[k];
      this.applyLook();
      this.updateRuleNote();
      if (this.translator && ['trProvider', 'trEndpoint', 'trModel', 'trTargetLang', 'trApiKey', 'trNoThink', 'trProfile', 'trUnit'].some(changed)) this.translator.reset();
      if (changed('uiLang')) this.relabel();
      if (this.pages && (changed('maxPages') || changed('prefetchAhead'))) {
        if (this.stopReason === 'limit' && this.pages.length < this.s.maxPages) this.stopReason = null;
        this.idleStatus();
        this.ensureAhead(this.currentIndex());
      }
    }

    onKey(e) {
      if (!this.opened) return;
      if (this.zapping && e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this.zapGrow(); return; }
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (this.picking) return;
        if (this.zapping) { this.stopZap(); return; }
        if (!this.el.panel.hidden) this.togglePanel(false); else this.close();
      }
    }

    /* ---- Nối trang ---- */
    async startFrom(doc, url) {
      const run = this.runId = (this.runId || 0) + 1;
      this.pages = [];
      this.visited = new Set();
      this.hashes = new Set();
      this.nextUrl = null;
      this.lastDoc = null;
      this.loading = false;
      this.stopReason = null;
      this.el.content.replaceChildren();
      const autoStart = this.translator ? this.translator.active : !!this.s.trAuto;
      if (this.translator) this.translator.destroy();
      this.translator = new RFTranslator.Translator({
        scrollRoot: this.el.scroll,
        getSettings: () => this.s,
        getTitle: () => (this.pages[0] && this.pages[0].title) || document.title,
        onStatus: (st) => this.showTrStatus(st)
      });
      this.pendingAutoStart = autoStart;
      const u = this.normUrl(url);
      this.visited.add(u);
      const next = RFNext.find(doc, url, { visited: this.visited, rule: this.rule });
      const opts = this.extractOpts();
      opts.liveBig = this.liveBig || [];
      // Trang đang mở: lấy luôn các file video mà player của trang đã tải (m3u8/mp4)
      try {
        opts.resourceUrls = performance.getEntriesByType('resource').map((e) => e.name)
          .filter((n) => /^https?:/.test(n) && /\.(m3u8|mp4|webm)(\?|$)/i.test(n) && !/\/(ads?|vast|preroll)[\/_-]|doubleclick|googlesyndication/i.test(n))
          // bỏ các mảnh của luồng HLS/DASH (init.mp4, seg-1.mp4, chunk_3.mp4…) — không phát riêng được
          .filter((n) => !/(^|[\/_-])(init|seg|segment|chunk|frag|fragment|part)[-_]?\d*\.(mp4|webm)(\?|$)/i.test(n) && !/\/\d+\.(mp4|webm)(\?|$)/.test(n))
          .sort((a, b) => (/master|playlist|index/i.test(b) ? 1 : 0) - (/master|playlist|index/i.test(a) ? 1 : 0))
          .filter((n, i, arr) => !(/\.m3u8/i.test(n) && arr.some((m, j) => j < i && /\.m3u8/i.test(m))));
      } catch (e) { /* bỏ qua */ }
      const res = RFExtract.extract(doc, url, opts);
      if (run !== this.runId) return;
      if (!res || (res.textLength < 30 && !res.mediaCount)) {
        this.setStatus('error', rfT('noContent'), false);
        return;
      }
      this.appendPage(res, url, next, doc);
      this.ensureAhead(0);
    }

    extractOpts() {
      const r = this.rule;
      return {
        keepMedia: this.s.keepMedia, minTextLength: this.s.minTextLength,
        contentSelector: r && r.contentSelector, removeSelector: r && r.removeSelector, removeTexts: (r && r.removeTexts) || []
      };
    }

    normUrl(u) { try { const x = new URL(u); x.hash = ''; return x.href; } catch (e) { return u; } }

    appendPage(res, url, next, doc) {
      const idx = this.pages.length;
      const section = h('section', { class: 'rf-page', 'data-idx': String(idx), lang: res.lang || null, dir: res.dir || null });
      if (idx === 0) {
        section.append(h('header', { class: 'rf-page-head' },
          (res.siteName || this.host) ? h('p', { class: 'rf-sitename' }, res.siteName || this.host) : null,
          h('h1', {}, res.title || document.title),
          (res.byline || res.date) ? h('p', { class: 'rf-byline' },
            res.byline ? h('span', {}, res.byline) : null, res.date ? h('span', {}, res.date) : null) : null));
      } else {
        const prevTitle = this.pages[idx - 1].title;
        const showTitle = res.title && res.title !== prevTitle && res.title !== this.pages[0].title;
        section.append(h('div', { class: 'rf-seam', role: 'separator', 'aria-label': rfT('pageN', idx + 1), 'data-n': String(idx + 1) },
          h('span', { class: 'rf-seam-num', 'aria-hidden': 'true' }, String(idx + 1)),
          h('span', { class: 'rf-seam-title', 'data-generic': showTitle ? null : '1' }, showTitle ? res.title : rfT('pageN', idx + 1)),
          h('a', { href: url, target: '_blank', rel: 'noopener', title: rfT('openOriginal') }, prettyUrl(url))));
      }
      const art = h('div', { class: 'rf-article' });
      art.append(sanitize(res.html));
      this.setupHls(art);
      // Readability đã đưa tiêu đề lên phần đầu; bỏ h1 trùng lặp ở đầu bài
      const firstH = art.querySelector('h1, h2');
      const sq = (t) => (t || '').replace(/[\s\u3000]+/g, '');
      if (firstH && sq(firstH.textContent) && sq(res.title).includes(sq(firstH.textContent))) firstH.remove();
      // Loạt bài hay lặp lại mục lục / lời dẫn ở mỗi phần: bỏ khối trùng với các trang trước
      const blockText = (el) => el.textContent.replace(/\s+/g, ' ').trim();
      if (!this.seenBlocks || idx === 0) this.seenBlocks = new Set();
      const dupCandidates = [...art.querySelectorAll('ul, ol, blockquote, p, table, dl')].filter((el) => !el.parentElement.closest('ul, ol, blockquote, table, dl'));
      if (idx > 0) for (const el of dupCandidates) { const t = blockText(el); if (t.length >= 40 && this.seenBlocks.has(t)) el.remove(); }
      for (const el of dupCandidates) if (art.contains(el)) this.seenBlocks.add(blockText(el));
      section.append(art);
      this.el.content.append(section);
      // Sau khi đã gắn vào trang: moveBefore() chỉ giữ trạng thái khi cả hai phía đang nằm trong document
      this.setupLiveVideos(art);
      this.pages.push({ url, title: res.title, section });
      this.hashes.add(res.hash);
      this.visited.add(this.normUrl(url));
      this.lastDoc = doc;
      this.nextUrl = next ? next.url : null;
      this.nextReason = next ? next.reason : null;
      this.translator.addSection(section, idx);
      if (idx === 0 && this.pendingAutoStart) { this.pendingAutoStart = false; this.translator.start(); }
      this.updateCounter();
      this.idleStatus();
    }

    currentIndex() {
      if (!this.pages || !this.pages.length) return 0;
      const top = this.el.scroll.scrollTop + this.el.scroll.clientHeight * 0.3;
      let idx = 0;
      for (let i = 0; i < this.pages.length; i++) if (this.pages[i].section.offsetTop <= top) idx = i;
      return idx;
    }

    ensureAhead(cur) {
      if (!this.pages || !this.pages.length) return;
      const ahead = Math.max(0, +this.s.prefetchAhead || 0);
      const target = Math.min(cur + ahead, this.s.maxPages - 1);
      if (this.pages.length - 1 < target) this.loadNext();
    }

    async loadNext() {
      if (this.loading || !this.opened) return;
      if (this.pages.length >= this.s.maxPages) { this.stopReason = 'limit'; this.idleStatus(); return; }
      if (!this.nextUrl) { this.stopReason = 'end'; this.idleStatus(); return; }
      if (this.stopReason === 'dup') return;
      const run = this.runId;
      const url = this.nextUrl;
      this.loading = true;
      this.stopReason = null;
      this.setStatus('loading', rfT('loadingPage', this.pages.length + 1));
      try {
        let { html, finalUrl } = await this.fetchHtml(url);
        if (run !== this.runId) return;
        let doc = new DOMParser().parseFromString(html, 'text/html');
        this.visited.add(this.normUrl(url));
        let next = RFNext.find(doc, finalUrl, { visited: this.visited, rule: this.rule });
        let res = RFExtract.extract(doc, finalUrl, this.extractOpts());
        const weak = !res || (res.textLength < this.s.minTextLength && res.mediaCount < 2);
        if (weak && this.s.jsRenderFallback) {
          this.setStatus('loading', rfT('renderingPage', this.pages.length + 1));
          const r = await chrome.runtime.sendMessage({ type: 'rf-render', url: finalUrl, waitMs: this.s.renderWaitMs });
          if (run !== this.runId) return;
          if (r && r.ok) {
            finalUrl = r.finalUrl || finalUrl;
            doc = new DOMParser().parseFromString(r.html, 'text/html');
            next = RFNext.find(doc, finalUrl, { visited: this.visited, rule: this.rule });
            res = RFExtract.extract(doc, finalUrl, this.extractOpts());
          }
        }
        if (!res || (res.textLength < 30 && !res.mediaCount)) throw new Error(rfT('extractFailed', this.pages.length + 1));
        if (this.hashes.has(res.hash)) {
          this.stopReason = 'dup';
          this.loading = false;
          this.idleStatus();
          return;
        }
        this.appendPage(res, finalUrl, next, doc);
      } catch (e) {
        if (run !== this.runId) return;
        this.loading = false;
        this.setStatus('error', (e && e.message) || String(e), true);
        return;
      }
      this.loading = false;
      this.idleStatus();
      this.ensureAhead(this.currentIndex());
      this.checkNearBottom();
    }

    async fetchHtml(url) {
      let sameOrigin = false;
      try { sameOrigin = new URL(url).origin === location.origin; } catch (e) { /* bỏ qua */ }
      if (sameOrigin) {
        try { return await rfFetchHtml(url); } catch (e) {
          if (!/Failed to fetch|NetworkError|CORS/i.test(e.message)) throw e;
        }
      }
      const r = await chrome.runtime.sendMessage({ type: 'rf-fetch', url });
      if (!r || !r.ok) throw new Error((r && r.error) || rfT('fetchFailed', url));
      return r;
    }

    onScroll() {
      const sc = this.el.scroll;
      const y = sc.scrollTop;
      const max = sc.scrollHeight - sc.clientHeight;
      this.el.progress.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
      if (this.lastY != null && this.el.panel.hidden) this.el.bar.classList.toggle('rf-hidden', y > this.lastY && y > 120);
      this.lastY = y;
      if (this.scrollRaf) return;
      this.scrollRaf = requestAnimationFrame(() => {
        this.scrollRaf = null;
        this.updateCounter();
        this.ensureAhead(this.currentIndex());
        this.checkNearBottom();
      });
    }

    checkNearBottom() {
      const sc = this.el && this.el.scroll;
      if (!sc || this.loading) return;
      const endOfContent = this.el.content.offsetTop + this.el.content.offsetHeight;
      if (sc.scrollTop + sc.clientHeight * 2 >= endOfContent) this.loadNext();
    }

    updateCounter() {
      if (!this.pages) return;
      const cur = this.currentIndex() + 1;
      this.el.counter.textContent = this.pages.length > 1 ? rfT('counter', cur, this.pages.length) : '';
    }

    showTrStatus(st) {
      const el = this.el && this.el.trstat;
      if (!el) return;
      this.lastTr = st;
      const active = !!st.active;
      el.classList.toggle('rf-err', !!st.errors);
      if (st.errors) el.textContent = st.lastError ? rfT('trError', st.lastError) : rfT('trErrorCount', st.errors);
      else if (!active) el.textContent = this.trStopped && st.any ? rfT('trPaused') : '';
      else if (st.summarizing) el.textContent = rfT('trSummarizing');
      else el.textContent = st.pending ? rfT('trPending', st.pending) : '';
      const btn = this.el.trBtn;
      btn.textContent = active ? rfT('trStop') : rfT('trStart');
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('rf-busy', active && (st.pending > 0 || st.summarizing > 0));
    }

    /* Nút Dịch: bấm để dịch, bấm lần nữa để dừng (giữ phần đã dịch) */
    toggleTranslate() {
      if (!this.translator) return;
      if (this.translator.active) { this.trStopped = true; this.translator.stop(); }
      else { this.trStopped = false; this.translator.start(); }
    }

    setStatus(kind, text, retry) {
      const E = this.el;
      this.lastStatus = kind === 'error' ? [kind, text, retry] : null;
      E.status.replaceChildren();
      if (kind === 'loading') E.status.append(h('span', { class: 'rf-loading' }, text));
      else E.status.append(h('span', {}, text));
      if (retry) {
        E.status.append(h('div', { class: 'rf-row' },
          h('button', { onclick: () => this.loadNext() }, rfT('retry')),
          this.nextUrl ? h('button', { onclick: () => window.open(this.nextUrl, '_blank', 'noopener') }, rfT('openNextTab')) : null));
      }
    }

    idleStatus() {
      if (this.loading) return;
      const E = this.el;
      this.lastStatus = null;
      E.status.replaceChildren();
      const n = this.pages.length;
      if (this.stopReason === 'limit' || (this.nextUrl && n >= this.s.maxPages)) {
        E.status.append(h('span', {}, rfT('limitReached', n)),
          h('button', { onclick: () => { this.save({ maxPages: this.s.maxPages + 5 }).then(() => this.loadNext()); } }, rfT('loadMore5')));
      } else if (this.stopReason === 'dup') {
        E.status.append(h('span', {}, rfT('duplicate')));
      } else if (!this.nextUrl) {
        E.status.append(h('span', {}, n > 1 ? rfT('endJoined', n) : rfT('noNext')));
        if (n === 1) E.status.append(h('button', { onclick: () => this.startPicker() }, rfT('pickNextOnPage')));
      } else {
        const b = h('button', { title: this.nextReason ? rfT('detectedVia', this.nextReason) : null, onclick: () => this.loadNext() }, rfT('loadPageN', n + 1));
        E.status.append(b);
      }
    }

    /* ---- Dịch đoạn đã chọn (menu chuột phải) ---- */
    async translateSelection(text) {
      text = (text || '').trim();
      if (!text) return;
      if (!this.s) this.s = await rfLoadSettings();
      await rfInitI18n(this.s.uiLang);
      const rect = this.selectionRect();
      const ctx = this.selectionContext();
      if (this.selPop) this.selPop.close();
      this.selPop = new SelectionPopup(text, rect, this.s, ctx, () => { this.selPop = null; });
    }

    selectionRect() {
      const root = this.hostEl && this.hostEl.shadowRoot;
      let sel = root && typeof root.getSelection === 'function' ? root.getSelection() : null;
      if (!sel || !sel.rangeCount || sel.isCollapsed) sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r.width || r.height) return r;
      }
      return null;
    }

    /* Trong chế độ đọc: kèm tiêu đề và tóm tắt các trang trước để dịch chuẩn hơn */
    selectionContext() {
      const ctx = { title: (this.pages && this.pages[0] && this.pages[0].title) || document.title };
      if (!this.opened || !this.translator) return ctx;
      const root = this.hostEl.shadowRoot;
      const sel = typeof root.getSelection === 'function' ? root.getSelection() : null;
      const node = sel && sel.anchorNode;
      const sec = node && (node.nodeType === 1 ? node : node.parentElement);
      const page = sec && sec.closest && sec.closest('.rf-page');
      const idx = page ? +page.dataset.idx : 0;
      if (idx > 0 && this.translator.summaryCache[idx - 1]) ctx.summary = this.translator.summaryCache[idx - 1];
      return ctx;
    }

    /* ---- Video HLS (.m3u8): Chrome không tự phát được, dùng hls.js ---- */
    setupHls(root) {
      // Nguồn MP4 hỏng thì chuyển sang HLS dự phòng (vd. Substack: …/src?type=hls)
      for (const v of root.querySelectorAll('video[data-rf-alt-hls]')) {
        const src = v.querySelector('source:last-of-type');
        const toHls = () => {
          if (v.getAttribute('data-rf-hls')) return;
          v.setAttribute('data-rf-hls', v.getAttribute('data-rf-alt-hls'));
          v.querySelectorAll('source').forEach((x) => x.remove());
          v.removeAttribute('src');
          this.attachHls(v);
        };
        if (src) src.addEventListener('error', toHls, { once: true }); else v.addEventListener('error', toHls, { once: true });
      }
      const vids = [...root.querySelectorAll('video[data-rf-hls]')];
      if (!vids.length) return;
      this.hlsList = this.hlsList || [];
      this.hlsIO = this.hlsIO || new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { this.hlsIO.unobserve(e.target); this.attachHls(e.target); }
      }, { root: this.el.scroll, rootMargin: '800px 0px' });
      vids.forEach((v) => this.hlsIO.observe(v));
    }

    async attachHls(v) {
      this.hlsList = this.hlsList || [];
      const url = v.getAttribute('data-rf-hls');
      if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; return; }
      try {
        if (!globalThis.Hls) {
          const r = await chrome.runtime.sendMessage({ type: 'rf-load-hls' });
          if (!r || !r.ok || !globalThis.Hls) throw new Error((r && r.error) || 'hls.js');
        }
        if (!Hls.isSupported()) throw new Error('MediaSource');
        const hls = new Hls({ enableWorker: false, autoStartLoad: false, capLevelToPlayerSize: true });
        hls.loadSource(url);
        hls.attachMedia(v);
        v.addEventListener('play', () => hls.startLoad(), { once: true });
        hls.on(Hls.Events.ERROR, (ev, data) => { if (data.fatal) { hls.destroy(); this.videoFailed(v); } });
        this.hlsList.push(hls);
      } catch (e) {
        this.videoFailed(v);
      }
    }

    videoFailed(v) {
      if (!v.isConnected) return;
      if (v.hasAttribute('data-rf-live') && this.borrow(v, v.getAttribute('data-rf-live'))) return;
      const page = v.closest('.rf-page');
      const url = page ? (this.pages[+page.dataset.idx] || {}).url : location.href;
      const box = h('div', { class: 'rf-media-missing' },
        v.getAttribute('poster') ? h('img', { src: v.getAttribute('poster'), alt: '' }) : null,
        h('a', { href: url || location.href, target: '_blank', rel: 'noopener' }, rfT('mediaVideoOnly')));
      v.replaceWith(box);
    }

    /* ---- Mượn player gốc của trang đang mở ---- */
    tagLiveVideos() {
      // Cả video nằm trong Shadow DOM của custom element (hls-video, mux-player, player web component…)
      const found = [];
      const walk = (root, host) => {
        for (const v of root.querySelectorAll('video')) found.push({ v, host });
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, host || el);
      };
      walk(document, null);
      this.liveVideos = found.map((x) => x.v);
      // Video trong shadow: gắn dấu lên phần tử chủ nằm ngoài, vì bản sao của trang không chứa shadow
      found.forEach((x, i) => (x.host || x.v).setAttribute('data-rf-vid', String(i)));
      this.liveFrames = [...document.querySelectorAll('iframe')];
      this.liveFrames.forEach((f, i) => f.setAttribute('data-rf-ifr', String(i)));
      // Các video đang hiện và đủ lớn, lớn nhất trước: ứng viên cho "video chính" của trang
      this.liveBig = this.liveVideos.map((v, i) => ({ i, r: v.getBoundingClientRect() }))
        .filter((x) => x.r.width >= 300 && x.r.height >= 150)
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height).map((x) => x.i);
    }

    setupLiveVideos(root) {
      // iframe player của trang đang mở: dùng chính iframe đang chạy (giữ trạng thái nhờ moveBefore)
      for (const box of root.querySelectorAll('.rf-embed[data-rf-live-frame]')) this.borrowFrame(box, box.getAttribute('data-rf-live-frame'));
      // iframe do trang điều khiển mà không có bản đang sống (trang 2 trở đi): mở lại sẽ trống -> dẫn về trang gốc
      for (const box of root.querySelectorAll('.rf-embed[data-rf-controlled]:not([data-rf-live-frame])')) {
        const page = box.closest('.rf-page');
        const url = page ? (this.pages[+page.dataset.idx] || {}).url || location.href : location.href;
        box.replaceWith(h('div', { class: 'rf-media-missing' }, h('a', { href: url, target: '_blank', rel: 'noopener' }, rfT('mediaVideoOnly'))));
      }
      // Chưa tìm được nguồn -> dùng luôn thẻ <video> thật của trang
      for (const ph of root.querySelectorAll('.rf-media-missing[data-rf-live]')) this.borrow(ph, ph.getAttribute('data-rf-live'));
      // Đã đoán nguồn nhưng phát lỗi (403, 404, định dạng lạ) -> cũng chuyển sang mượn
      for (const v of root.querySelectorAll('video[data-rf-live]')) {
        if (v.hasAttribute('data-rf-alt-hls') || v.hasAttribute('data-rf-hls')) continue; // hls.js tự báo lỗi qua videoFailed
        const fail = () => this.videoFailed(v);
        const last = v.querySelector('source:last-of-type');
        if (last) last.addEventListener('error', fail, { once: true }); else v.addEventListener('error', fail, { once: true });
      }
    }

    /* Chuyển chính phần tử <video> đang sống vào khung đọc. Luồng MediaSource (blob:), cookie và khoá DRM
     * đều đi theo phần tử nên video phát được như trên trang gốc. Khi đóng sẽ trả về đúng chỗ cũ. */
    borrow(target, n) {
      const v = this.liveVideos && this.liveVideos[+n];
      if (!v || !v.isConnected || v.getRootNode() !== document) { this.pipBox(target, v); return false; }
      const marker = document.createComment('rf-borrowed-video');
      v.parentNode.insertBefore(marker, v);
      const rec = { v, marker, controls: v.hasAttribute('controls'), style: v.getAttribute('style') };
      const wrap = h('div', { class: 'rf-borrowed' });
      target.replaceWith(wrap);
      wrap.append(v);
      v.controls = true;
      v.setAttribute('style', 'display:block;width:100%;height:auto;max-height:80vh;position:static;inset:auto;transform:none;' +
        'opacity:1;visibility:visible;object-fit:contain;background:#000;margin:0;');
      wrap.append(h('div', { class: 'rf-borrowed-tools' }, this.pipButton(v),
        h('a', { href: location.href, target: '_blank', rel: 'noopener' }, rfT('vidOpenOriginal'))));
      (this.borrowed = this.borrowed || []).push(rec);
      // Trang tự dựng lại player và lấy phần tử đi -> hiện nút cửa sổ nổi thay thế
      rec.mo = new MutationObserver(() => {
        if (wrap.contains(v)) return;
        rec.mo.disconnect();
        this.borrowed = this.borrowed.filter((x) => x !== rec);
        this.pipBox(wrap, v);
      });
      rec.mo.observe(wrap, { childList: true });
      return true;
    }

    /* Chuyển iframe đang chạy của trang vào khung đọc. Element.moveBefore() (Chrome 133+) giữ nguyên trạng
     * thái iframe (không tải lại), nên player do trang điều khiển như BBC vẫn chạy. */
    borrowFrame(box, n) {
      const f = this.liveFrames && this.liveFrames[+n];
      const controlled = box.hasAttribute('data-rf-controlled');
      if (!f || !f.isConnected || typeof box.moveBefore !== 'function') {
        // Không chuyển được: iframe tự chạy được (YouTube…) thì giữ bản mới; còn lại cho xem ngay trên trang
        if (controlled) this.peekBox(box, f);
        return false;
      }
      const marker = document.createComment('rf-borrowed-frame');
      f.parentNode.insertBefore(marker, f);
      const rec = { v: f, marker, frame: true, style: f.getAttribute('style') };
      box.replaceChildren();
      try { box.moveBefore(f, null); } catch (e) { marker.remove(); if (controlled) this.peekBox(box, f); return false; }
      f.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;visibility:visible;opacity:1;');
      const tools = h('div', { class: 'rf-borrowed-tools' },
        h('span', { class: 'rf-hint' }, rfT('vidFramePip')),
        h('a', { href: location.href, target: '_blank', rel: 'noopener' }, rfT('vidOpenOriginal')));
      box.after(tools);
      (this.borrowed = this.borrowed || []).push(rec);
      chrome.runtime.sendMessage({ type: 'rf-frame-pip', url: f.src, label: rfT('vidPip') }).catch(() => {});
      return true;
    }

    /* Xem ngay trên trang gốc: ẩn khung đọc, cuộn tới player, hiện nút quay lại */
    peek(el) {
      if (!el || !el.isConnected) return;
      const target = el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : el;
      this.hostEl.style.display = 'none';
      document.documentElement.style.overflow = this.prevOverflow || '';
      target.scrollIntoView({ block: 'center' });
      const pill = document.createElement('button');
      pill.textContent = rfT('vidBack');
      pill.style.cssText = 'all:initial;position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;cursor:pointer;' +
        'font:600 14px/1.2 system-ui,sans-serif;color:#fff;background:#22262A;padding:10px 16px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.3);';
      const back = () => {
        pill.remove();
        document.removeEventListener('keydown', onKey, true);
        if (!this.opened || !this.hostEl) return;
        this.hostEl.style.display = 'block';
        document.documentElement.style.overflow = 'hidden';
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); back(); } };
      pill.addEventListener('click', back);
      document.addEventListener('keydown', onKey, true);
      document.documentElement.append(pill);
      this.peekBack = back;
    }

    peekBox(target, el) {
      const box = h('div', { class: 'rf-media-missing' },
        el && el.isConnected ? h('button', { onclick: () => this.peek(el) }, rfT('vidPeek')) : null,
        h('a', { href: location.href, target: '_blank', rel: 'noopener' }, rfT('mediaVideoOnly')));
      target.replaceWith(box);
    }

    returnBorrowed() {
      for (const rec of this.borrowed || []) {
        rec.mo && rec.mo.disconnect();
        const { v, marker } = rec;
        if (marker.isConnected && rec.frame && typeof marker.parentNode.moveBefore === 'function') {
          try { marker.parentNode.moveBefore(v, marker); } catch (e) { marker.parentNode.insertBefore(v, marker); }
        } else if (marker.isConnected) marker.parentNode.insertBefore(v, marker);
        marker.remove();
        if (!rec.controls) v.removeAttribute('controls');
        if (rec.style == null) v.removeAttribute('style'); else v.setAttribute('style', rec.style);
      }
      this.borrowed = [];
    }

    pipButton(v) {
      if (!v || !document.pictureInPictureEnabled || v.disablePictureInPicture) return null;
      const b = h('button', { onclick: async () => {
        try {
          if (document.pictureInPictureElement === v) await document.exitPictureInPicture();
          else { await v.requestPictureInPicture(); if (v.paused) v.play().catch(() => {}); }
        } catch (e) { b.textContent = rfT('vidPipFail'); }
      } }, rfT('vidPip'));
      return b;
    }

    /* Không mượn được: vẫn cho xem bằng cửa sổ nổi, player gốc tiếp tục phát ở trang phía dưới */
    pipBox(target, v) {
      const poster = (target.querySelector && target.querySelector('img')) ? target.querySelector('img').getAttribute('src') : (v && v.getAttribute('poster'));
      const box = h('div', { class: 'rf-media-missing' },
        poster ? h('img', { src: poster, alt: '' }) : null,
        v && v.isConnected ? this.pipButton(v) : null,
        v && v.isConnected ? h('button', { onclick: () => this.peek(v) }, rfT('vidPeek')) : null,
        h('a', { href: location.href, target: '_blank', rel: 'noopener' }, rfT('mediaVideoOnly')));
      target.replaceWith(box);
    }

    /* ---- Đọc to (giọng của trình duyệt) ---- */
    createSpeaker() {
      this.speaker = new RFSpeaker.Speaker({
        getSettings: () => this.s,
        getContent: () => this.el.content,
        scrollEl: this.el.scroll,
        translatorState: () => ({ mode: this.translator && this.translator.active ? 'on' : 'off', paused: false }),
        needMore: () => this.waitForMorePages(),
        onState: (st) => this.showTts(st)
      });
      // Nhấp đúp vào một đoạn để đọc từ đó
      this.el.content.addEventListener('dblclick', (e) => {
        if (!this.playerOpen || this.zapping) return;
        const blocks = RFTranslator.readableBlocks(this.el.content);
        const b = blocks.find((x) => x.contains(e.target));
        if (b) { e.preventDefault(); this.speaker.stop(); this.speaker.play(b); }
      });
    }

    buildPlayer() {
      const E = this.el;
      const speed = h('select', { 'aria-label': rfT('ttsSpeed'), title: rfT('ttsSpeed'), onchange: (e) => { this.save({ ttsRate: +e.target.value }); this.speaker && this.speaker.restartSegment(); } },
        ...[0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2].map((v) => h('option', { value: String(v) }, v + '×')));
      speed.value = String(this.s.ttsRate || 1);
      if (!speed.value) speed.value = '1';
      const source = h('select', { 'aria-label': rfT('ttsSourceLabel'), title: rfT('ttsSourceLabel'), onchange: (e) => { this.save({ ttsSource: e.target.value }); this.speaker && this.speaker.restartSegment(); } },
        h('option', { value: 'auto' }, rfT('ttsSrcAuto')), h('option', { value: 'original' }, rfT('ttsSrcOriginal')), h('option', { value: 'translation' }, rfT('ttsSrcTranslation')));
      source.value = this.s.ttsSource || 'auto';
      E.ttsPlay = h('button', { class: 'rf-tts-main', onclick: () => this.speaker.toggle() }, '▶');
      E.ttsStat = h('span', { class: 'rf-tts-stat', role: 'status' });
      return h('div', { class: 'rf-player', hidden: !this.playerOpen, role: 'group', 'aria-label': rfT('ttsListen'), title: rfT('ttsDblHint') },
        h('button', { 'aria-label': rfT('ttsPrev'), title: rfT('ttsPrev'), onclick: () => this.speaker.skip(-1) }, '⏮'),
        E.ttsPlay,
        h('button', { 'aria-label': rfT('ttsNext'), title: rfT('ttsNext'), onclick: () => this.speaker.skip(1) }, '⏭'),
        speed, source, E.ttsStat,
        h('button', { 'aria-label': rfT('ttsClose'), title: rfT('ttsClose'), onclick: () => this.toggleListen(false) }, '✕'));
    }

    toggleListen(force) {
      const open = force != null ? force : !this.playerOpen;
      this.playerOpen = open;
      this.el.player.hidden = !open;
      this.el.root.classList.toggle('rf-player-open', open);
      this.el.listenBtn.setAttribute('aria-pressed', String(open));
      if (open) this.speaker.play(); else this.speaker.stop();
    }

    showTts(st) {
      this.lastTts = st;
      const E = this.el;
      if (!E || !E.ttsPlay) return;
      const playing = st.state === 'playing';
      E.ttsPlay.textContent = playing ? '⏸' : '▶';
      E.ttsPlay.setAttribute('aria-label', playing ? rfT('ttsPause') : rfT('ttsPlay'));
      E.ttsPlay.title = E.ttsPlay.getAttribute('aria-label');
      E.ttsStat.textContent = st.error || st.note || '';
      E.ttsStat.classList.toggle('rf-err', !!st.error);
    }

    /* Đọc tới cuối nội dung đã tải: tải trang kế rồi đọc tiếp */
    async waitForMorePages() {
      const start = this.pages.length;
      if (!this.loading) this.loadNext();
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        if (!this.opened) return false;
        if (this.pages.length > start) return true;
        if (!this.loading && (this.stopReason || !this.nextUrl || this.pages.length >= this.s.maxPages)) return false;
        await new Promise((r) => setTimeout(r, 400));
      }
      return false;
    }

    /* ---- Ẩn phần thừa ngay trong giao diện đọc ---- */
    startZap() {
      if (this.zapping) return;
      this.zapping = true;
      this.togglePanel(false);
      const E = this.el;
      E.root.classList.add('rf-zapping');
      E.zapTip = h('div', { class: 'rf-zap-tip', role: 'status' }, h('span', {}, rfT('zapTip')),
        h('button', { onclick: () => this.stopZap() }, rfT('zapDone')));
      E.root.append(E.zapTip);
      const ZAP_SEL = 'p, li, ul, ol, dl, h1, h2, h3, h4, h5, h6, blockquote, figure, table, pre, div';
      this.zapOver = (e) => {
        const t = e.target.closest && e.target.closest(ZAP_SEL);
        this.zapSet(t && t.closest('.rf-article') ? t : null);
      };
      this.zapClick = (e) => {
        if (!this.zapTarget) return;
        e.preventDefault(); e.stopPropagation();
        this.zapRemove(this.zapTarget);
      };
      E.content.addEventListener('mouseover', this.zapOver);
      E.content.addEventListener('click', this.zapClick, true);
    }

    zapSet(t) {
      if (this.zapTarget) this.zapTarget.classList.remove('rf-zap-hover');
      this.zapTarget = t;
      if (t) t.classList.add('rf-zap-hover');
    }

    zapGrow() {
      const t = this.zapTarget;
      if (t && t.parentElement && !t.parentElement.classList.contains('rf-article')) this.zapSet(t.parentElement);
    }

    zapText(el) {
      const c = el.cloneNode(true);
      c.querySelectorAll('.rf-tr').forEach((x) => x.remove());
      return c.textContent.replace(/\s+/g, ' ').trim();
    }

    async zapRemove(el) {
      const text = this.zapText(el);
      this.zapSet(null);
      el.remove();
      if (!text || text.length > 300) return; // khối dài: chỉ ẩn lần này
      // Ẩn luôn các khối cùng chữ ở những trang đã tải
      for (const x of [...this.el.content.querySelectorAll('.rf-article *')]) {
        if (x.isConnected && this.zapText(x) === text) x.remove();
      }
      const rules = Object.assign({}, this.s.siteRules || {});
      const r = Object.assign({}, rules[this.host] || {});
      const list = (r.removeTexts || []).filter((t) => t !== text);
      list.push(text);
      r.removeTexts = list.slice(-200);
      rules[this.host] = r;
      await this.save({ siteRules: rules });
      this.updateRuleNote();
    }

    stopZap() {
      if (!this.zapping) return;
      this.zapping = false;
      const E = this.el;
      this.zapSet(null);
      E.root.classList.remove('rf-zapping');
      if (E.zapTip) E.zapTip.remove();
      E.content.removeEventListener('mouseover', this.zapOver);
      E.content.removeEventListener('click', this.zapClick, true);
    }

    /* ---- Chọn nút "Trang sau" trên trang gốc ---- */
    startPicker() {
      if (this.picking) return;
      this.picking = true;
      this.togglePanel(false);
      this.hostEl.style.display = 'none';
      document.documentElement.style.overflow = this.prevOverflow || '';
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #2B5D7C;background:rgba(43,93,124,.15);border-radius:4px;display:none;';
      const tip = document.createElement('div');
      tip.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#22262A;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:9px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.3);';
      tip.textContent = rfT('pickerTip');
      document.documentElement.append(box, tip);
      let target = null;
      const move = (e) => {
        target = e.target.closest && e.target.closest('a[href]');
        if (!target) { box.style.display = 'none'; return; }
        const r = target.getBoundingClientRect();
        Object.assign(box.style, { display: 'block', left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' });
      };
      const block = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
      const click = (e) => {
        block(e);
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a) { tip.textContent = rfT('pickerNotLink'); return; }
        const rule = Object.assign({}, this.rule || {}, { nextSelector: RFNext.selectorFor(a, document), nextText: RFNext.linkText(a) });
        stop();
        this.saveRule(rule);
      };
      const key = (e) => { if (e.key === 'Escape') { block(e); stop(); } };
      const stop = this.stopPicker = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('click', click, true);
        document.removeEventListener('mousedown', block, true);
        document.removeEventListener('keydown', key, true);
        box.remove(); tip.remove();
        this.picking = false;
        this.stopPicker = null;
        if (this.hostEl) {
          this.hostEl.style.display = 'block';
          document.documentElement.style.overflow = 'hidden';
        }
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('click', click, true);
      document.addEventListener('mousedown', block, true);
      document.addEventListener('keydown', key, true);
    }

    async saveRule(rule) {
      const rules = Object.assign({}, this.s.siteRules || {});
      rules[this.host] = rule;
      await this.save({ siteRules: rules });
      this.updateRuleNote();
      this.restart();
    }

    async clearRule() {
      const rules = Object.assign({}, this.s.siteRules || {});
      delete rules[this.host];
      await this.save({ siteRules: rules });
      this.updateRuleNote();
      this.restart();
    }

    restart() {
      if (this.speaker) this.speaker.stop();
      this.returnBorrowed();
      this.tagLiveVideos();
      const snapshot = document.cloneNode(true);
      snapshot.querySelectorAll(HOST_TAG + ',' + SEL_TAG).forEach((e) => e.remove());
      this.el.scroll.scrollTop = 0;
      this.startFrom(snapshot, location.href);
    }
  }


  /* Khung hiện bản dịch của đoạn đã chọn; dùng Shadow DOM riêng nên chạy được cả ngoài chế độ đọc. */
  class SelectionPopup {
    constructor(text, rect, settings, ctx, onClose) {
      this.text = text;
      this.s = settings;
      this.ctx = ctx;
      this.onClose = onClose;
      this.host = h(SEL_TAG);
      this.host.style.cssText = 'all:initial;position:fixed;inset:0 auto auto 0;z-index:2147483647;display:block;';
      const root = this.host.attachShadow({ mode: 'open' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(globalThis.RF_SEL_CSS);
      root.adoptedStyleSheets = [sheet];
      const target = settings.trTargetLang || RF_LOCALE_TARGET[rfI18n.lang] || 'English';
      this.out = h('div', { class: 'out pending', lang: RFTranslator.langCode(target) || null, 'aria-live': 'polite' });
      this.copyBtn = h('button', { onclick: () => this.copy() }, rfT('selCopy'));
      this.box = h('div', { class: 'box theme-' + (settings.theme || 'auto'), role: 'dialog', 'aria-label': rfT('selTitle') },
        h('div', { class: 'head' },
          h('span', { class: 'title' }, rfT('selTitle') + ' → ' + target),
          h('button', { onclick: () => this.speak() }, rfT('ttsListen')),
          this.copyBtn,
          h('button', { class: 'x', 'aria-label': rfT('selClose'), title: rfT('selClose'), onclick: () => this.close() }, '✕')),
        h('div', { class: 'src' }, text),
        this.out);
      root.append(this.box);
      document.documentElement.append(this.host);
      this.place(rect);
      this.onDown = (e) => { if (!e.composedPath().includes(this.host)) this.close(); };
      this.onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
      setTimeout(() => {
        document.addEventListener('mousedown', this.onDown, true);
        document.addEventListener('keydown', this.onKey, true);
      }, 0);
      this.run();
    }

    place(rect) {
      const W = Math.min(440, window.innerWidth - 24);
      this.box.style.width = W + 'px';
      const bh = this.box.getBoundingClientRect().height || 160;
      let left, top;
      if (rect) {
        left = Math.min(Math.max(12, rect.left), window.innerWidth - W - 12);
        top = rect.bottom + 10;
        if (top + Math.max(bh, 180) > window.innerHeight - 12) top = Math.max(12, rect.top - Math.max(bh, 180) - 10);
      } else {
        left = window.innerWidth - W - 16;
        top = 64;
      }
      this.box.style.left = left + 'px';
      this.box.style.top = top + 'px';
    }

    run() {
      this.out.textContent = '';
      this.out.classList.add('pending');
      this.out.classList.remove('err');
      this.job = RFTranslator.quickTranslate(this.text, this.s, this.ctx, (t) => { this.out.textContent = t; });
      this.job.promise.then((t) => {
        this.result = t;
        this.out.classList.remove('pending');
      }, (e) => {
        this.out.classList.remove('pending');
        this.out.classList.add('err');
        this.out.replaceChildren(h('span', {}, rfT('trFailed', e.message) + ' '), h('button', { onclick: () => this.run() }, rfT('retry')));
      });
    }

    async copy() {
      try {
        await navigator.clipboard.writeText(this.result || this.out.textContent);
        this.copyBtn.textContent = rfT('selCopied');
        setTimeout(() => { if (this.copyBtn) this.copyBtn.textContent = rfT('selCopy'); }, 1500);
      } catch (e) { /* trang không cho phép ghi clipboard */ }
    }

    async speak() {
      const text = this.result || this.out.textContent;
      if (!text) return;
      const lang = this.out.lang || '';
      const voice = await RFSpeaker.pickVoice(lang, this.s.ttsVoices);
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else if (lang) u.lang = lang;
      u.rate = +this.s.ttsRate || 1;
      this.utter = u;
      speechSynthesis.speak(u);
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      if (this.job) this.job.cancel();
      if (this.utter) speechSynthesis.cancel();
      document.removeEventListener('mousedown', this.onDown, true);
      document.removeEventListener('keydown', this.onKey, true);
      this.host.remove();
      this.onClose();
    }
  }

  const app = new App();
  globalThis.__rf = app;
  if (!globalThis.__rfNoAutoOpen) app.open();
  globalThis.__rfNoAutoOpen = false;
})();
