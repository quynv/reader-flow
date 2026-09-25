/* Trang tuỳ chọn Reader Flow */
(async () => {
  let s = await rfLoadSettings();
  // Ngôn ngữ đích để trống nghĩa là "theo ngôn ngữ giao diện"; hiện giá trị đó làm placeholder
  s.trTargetLang = (await chrome.storage.local.get('trTargetLang')).trTargetLang || '';
  const $ = (sel) => document.querySelector(sel);

  async function localize() {
    await rfInitI18n(s.uiLang);
    const ui = $('#uiLang');
    ui.replaceChildren(...Object.entries(Object.assign({ auto: rfT('uiLangAuto') }, RF_LOCALE_NAMES))
      .map(([v, l]) => Object.assign(document.createElement('option'), { value: v, textContent: l })));
    ui.value = s.uiLang;
    rfApplyI18n(document);
    document.querySelector('[data-key="trTargetLang"]').placeholder = RF_LOCALE_TARGET[rfI18n.lang];
    document.title = rfT('optTitle');
    onProvider(false);
    renderRules();
    renderVoices();
  }

  /* Giọng đọc của trình duyệt, nhóm theo ngôn ngữ */
  const SAMPLES = {
    vi: 'Xin chào, đây là giọng đọc thử của Reader Flow.', ja: 'こんにちは。Reader Flow の読み上げテストです。',
    en: 'Hello, this is a Reader Flow voice test.', zh: '你好，这是 Reader Flow 的朗读测试。', ko: '안녕하세요. Reader Flow 음성 테스트입니다.',
    fr: 'Bonjour, ceci est un test de voix de Reader Flow.', de: 'Hallo, das ist ein Stimmtest von Reader Flow.', es: 'Hola, esta es una prueba de voz de Reader Flow.'
  };
  function loadVoices() {
    return new Promise((resolve) => {
      const v = speechSynthesis.getVoices();
      if (v.length) return resolve(v);
      speechSynthesis.addEventListener('voiceschanged', () => resolve(speechSynthesis.getVoices()), { once: true });
      setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
    });
  }
  async function renderVoices() {
    const box = $('#voices');
    const voices = await loadVoices();
    box.replaceChildren();
    if (!voices.length) { box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: rfT('optTtsNoVoices') })); return; }
    const base = (l) => l.toLowerCase().split(/[-_]/)[0];
    const groups = {};
    for (const v of voices) (groups[base(v.lang)] = groups[base(v.lang)] || []).push(v);
    const first = ['vi', 'ja', 'en', rfI18n.lang];
    const langs = Object.keys(groups).sort((a, b) => {
      const ia = first.indexOf(a), ib = first.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    let names;
    try { names = new Intl.DisplayNames([rfI18n.lang], { type: 'language' }); } catch (e) { names = { of: (x) => x }; }
    for (const lang of langs) {
      const row = document.createElement('label');
      const title = document.createElement('span');
      title.textContent = names.of(lang) + ' (' + lang + ')';
      const wrap = document.createElement('span');
      wrap.className = 'combo';
      const sel = document.createElement('select');
      sel.append(Object.assign(document.createElement('option'), { value: '', textContent: rfT('ttsVoiceAuto') }));
      for (const v of groups[lang]) sel.append(Object.assign(document.createElement('option'), { value: v.voiceURI, textContent: v.name + (v.localService ? '' : ' ☁') }));
      sel.value = (s.ttsVoices || {})[lang] || '';
      sel.addEventListener('change', async () => {
        const map = Object.assign({}, s.ttsVoices || {});
        if (sel.value) map[lang] = sel.value; else delete map[lang];
        s.ttsVoices = map;
        await rfSaveSettings({ ttsVoices: map });
      });
      const test = Object.assign(document.createElement('button'), { type: 'button', textContent: rfT('optTtsTest') });
      test.addEventListener('click', (e) => {
        e.preventDefault();
        speechSynthesis.cancel();
        const list = groups[lang];
        const v = list.find((x) => x.voiceURI === sel.value) || list.find((x) => /natural|neural|online|premium|enhanced/i.test(x.name)) || list[0];
        const u = new SpeechSynthesisUtterance(SAMPLES[lang] || SAMPLES.en);
        u.voice = v; u.lang = v.lang; u.rate = +s.ttsRate || 1;
        speechSynthesis.speak(u);
      });
      wrap.append(sel, test);
      row.append(title, wrap);
      box.append(row);
    }
  }

  for (const el of document.querySelectorAll('[data-key]')) {
    const k = el.dataset.key;
    if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k];
    el.addEventListener('change', async () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number') {
        v = +el.value;
        if (el.min !== '') v = Math.max(+el.min, v);
        if (el.max !== '') v = Math.min(+el.max, v);
        el.value = v;
      } else v = el.value.trim();
      s[k] = v;
      await rfSaveSettings({ [k]: v });
      if (k === 'trProvider') onProvider(true);
    });
  }

  function onProvider(changed) {
    const p = $('#provider').value;
    const ep = $('#endpoint');
    if (changed) {
      ep.value = p === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1';
      ep.dispatchEvent(new Event('change'));
    }
    $('#endpointHint').innerHTML = rfT(p === 'ollama' ? 'optEndpointOllamaHtml' : 'optEndpointOpenAIHtml');
  }

  const cfg = () => ({ provider: s.trProvider, endpoint: s.trEndpoint, model: s.trModel, apiKey: s.trApiKey, temperature: +s.trTemperature, noThink: !!s.trNoThink, numCtx: +s.trNumCtx || 0 });

  $('#loadModels').addEventListener('click', async () => {
    const out = $('#testOut');
    out.className = ''; out.textContent = rfT('optLoadingModels');
    const r = await chrome.runtime.sendMessage({ type: 'rf-list-models', cfg: cfg() });
    if (!r.ok) { out.className = 'err'; out.textContent = rfT('optModelsFailed', r.error); return; }
    $('#models').replaceChildren(...r.models.map((m) => Object.assign(document.createElement('option'), { value: m })));
    out.className = 'ok';
    out.textContent = r.models.length ? rfT('optModelsFound', r.models.length, r.models.join(', ')) : rfT('optNoModels');
  });

  $('#testBtn').addEventListener('click', () => {
    const out = $('#testOut');
    out.className = ''; out.textContent = '';
    const port = chrome.runtime.connect({ name: 'rf-llm' });
    const t0 = performance.now();
    port.onMessage.addListener((m) => {
      if (m.type === 'delta') out.textContent += m.text;
      else if (m.type === 'done') { out.className = 'ok'; out.textContent += '\n' + rfT('optSeconds', ((performance.now() - t0) / 1000).toFixed(1)); port.disconnect(); }
      else if (m.type === 'error') { out.className = 'err'; out.textContent = m.error; port.disconnect(); }
    });
    port.postMessage({
      type: 'translate', id: 1, cfg: cfg(),
      messages: [{ role: 'user', content: 'Translate the following text into ' + (s.trTargetLang || RF_LOCALE_TARGET[rfI18n.lang]) +
        '. Note that you should only output the translated result without any additional explanation:\n\nThe quick brown fox reads the next page before you even finish this one.' }]
    });
  });

  /* Quy tắc theo tên miền */
  function renderRules() {
    const box = $('#rules');
    box.replaceChildren();
    const rules = s.siteRules || {};
    const hosts = Object.keys(rules);
    if (!hosts.length) { box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: rfT('optNoRules') })); return; }
    const head = document.createElement('div');
    head.className = 'rule rule-head';
    head.append(...['optRuleDomain', 'optRuleNextSel', 'optRuleNextText', 'optRuleContentSel', 'optRuleRemoveSel', null]
      .map((k) => Object.assign(document.createElement('span'), { textContent: k ? rfT(k) : '' })));
    box.append(head);
    for (const host of hosts) {
      const r = rules[host];
      const row = document.createElement('div');
      row.className = 'rule';
      const mk = (val, ph) => Object.assign(document.createElement('input'), { type: 'text', value: val || '', placeholder: ph, spellcheck: false });
      const iHost = mk(host, 'example.com'), iSel = mk(r.nextSelector, 'a.next'), iTxt = mk(r.nextText, rfT('optRuleTextPh')), iCon = mk(r.contentSelector, 'article .content'), iRem = mk(r.removeSelector, '.share, .ad');
      const del = Object.assign(document.createElement('button'), { type: 'button', textContent: rfT('optDelete') });
      const commit = async () => {
        const all = Object.assign({}, s.siteRules);
        delete all[host];
        const h = iHost.value.trim().replace(/^www\./, '');
        if (h) all[h] = Object.assign({}, r, { nextSelector: iSel.value.trim(), nextText: iTxt.value.trim(), contentSelector: iCon.value.trim(), removeSelector: iRem.value.trim() });
        s.siteRules = all;
        await rfSaveSettings({ siteRules: all });
        renderRules();
      };
      [iHost, iSel, iTxt, iCon, iRem].forEach((i) => i.addEventListener('change', commit));
      del.addEventListener('click', async () => {
        const all = Object.assign({}, s.siteRules); delete all[host];
        s.siteRules = all; await rfSaveSettings({ siteRules: all }); renderRules();
      });
      row.append(iHost, iSel, iTxt, iCon, iRem, del);
      box.append(row);
    }
  }
  $('#addRule').addEventListener('click', async () => {
    const all = Object.assign({}, s.siteRules);
    let n = 1; while (all['ten-mien-' + n + '.com']) n++;
    all['ten-mien-' + n + '.com'] = { nextSelector: '', nextText: '', contentSelector: '' };
    s.siteRules = all; await rfSaveSettings({ siteRules: all }); renderRules();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    for (const [k, v] of Object.entries(ch)) s[k] = v.newValue === undefined ? RF_DEFAULTS[k] : v.newValue;
    for (const el of document.querySelectorAll('[data-key]')) {
      const k = el.dataset.key;
      if (!(k in ch) || el === document.activeElement) continue;
      if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k];
    }
    if (ch.siteRules) renderRules();
    if (ch.uiLang) localize();
  });
  await localize();
})();
