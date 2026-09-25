/* Reader Flow — đọc to bằng giọng có sẵn của trình duyệt / hệ điều hành (Web Speech API). */
globalThis.RFSpeaker = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const baseLang = (l) => (l || '').toLowerCase().split(/[-_]/)[0];
  // Điểm móc để kiểm thử; bình thường dùng API của trình duyệt
  const synth = () => globalThis.__rfSynth || window.speechSynthesis;
  const Utterance = () => globalThis.__rfUtterance || window.SpeechSynthesisUtterance;

  /* Chia văn bản thành câu rồi gộp thành đoạn ngắn. Đoạn ngắn tránh lỗi giọng Google
   * trên Chrome tự dừng sau khoảng 15 giây, và giúp tạm dừng/tiếp tục chính xác hơn. */
  function splitText(text, lang, maxLen = 220) {
    let sentences;
    try {
      sentences = [...new Intl.Segmenter(lang || undefined, { granularity: 'sentence' }).segment(text)].map((x) => x.segment);
    } catch (e) {
      sentences = text.split(/(?<=[.!?。！？])\s*/);
    }
    const out = [];
    let cur = '';
    for (let s of sentences) {
      while (s.length > maxLen) {
        const cut = Math.max(s.lastIndexOf(',', maxLen), s.lastIndexOf('、', maxLen), s.lastIndexOf('，', maxLen), s.lastIndexOf(' ', maxLen), Math.floor(maxLen * 0.6));
        if (cur) { out.push(cur); cur = ''; }
        out.push(s.slice(0, cut + 1));
        s = s.slice(cut + 1);
      }
      if (cur && (cur + s).length > maxLen) { out.push(cur); cur = ''; }
      cur += s;
    }
    if (cur) out.push(cur);
    return out.map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
  }

  function getVoices() {
    return new Promise((resolve) => {
      const v = synth().getVoices();
      if (v.length) return resolve(v);
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(synth().getVoices()); } };
      synth().addEventListener('voiceschanged', finish, { once: true });
      setTimeout(finish, 1500);
    });
  }

  /* Giọng người dùng chọn cho ngôn ngữ đó, nếu không thì giọng "tự nhiên" tốt nhất có sẵn. */
  async function pickVoice(lang, prefs) {
    const voices = await getVoices();
    const base = baseLang(lang);
    const pref = prefs && prefs[base];
    if (pref) { const v = voices.find((x) => x.voiceURI === pref); if (v) return v; }
    const matches = voices.filter((v) => baseLang(v.lang) === base);
    if (!matches.length) return null;
    const score = (v) => (/natural|neural|online|premium|enhanced/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 1 : 0) +
      (v.lang.toLowerCase().replace('_', '-') === (lang || '').toLowerCase() ? 1 : 0);
    return matches.sort((a, b) => score(b) - score(a))[0];
  }

  class Speaker {
    /**
     * getSettings(), getContent() -> phần tử chứa các trang, scrollEl,
     * translatorState() -> { mode, paused }, needMore() -> Promise<boolean>, onState(st)
     */
    constructor(o) {
      Object.assign(this, o);
      this.state = 'idle'; // idle | playing | paused
      this.idx = 0;
      this.seg = 0;
      this.token = 0;
      this.current = null;
    }

    get s() { return this.getSettings(); }

    blocks() { return RFTranslator.readableBlocks(this.getContent()); }

    firstVisibleIndex(blocks) {
      const top = this.scrollEl.getBoundingClientRect().top + 60;
      const i = blocks.findIndex((b) => b.getBoundingClientRect().bottom > top);
      return i < 0 ? 0 : i;
    }

    emit(extra) { this.onState(Object.assign({ state: this.state }, extra || {})); }

    /* ---------- Điều khiển ---------- */

    play(fromBlock) {
      const blocks = this.blocks();
      if (fromBlock) { const i = blocks.indexOf(fromBlock); if (i >= 0) { this.idx = i; this.seg = 0; } }
      else if (this.state === 'idle') { this.idx = this.firstVisibleIndex(blocks); this.seg = 0; }
      this.state = 'playing';
      this.run(++this.token);
    }

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.token++;
      this.silence();
      this.emit();
    }

    toggle() { if (this.state === 'playing') this.pause(); else this.play(); }

    stop() {
      this.token++;
      this.silence();
      this.state = 'idle';
      this.highlight(null);
      this.seg = 0;
      this.emit();
    }

    skip(delta) {
      const blocks = this.blocks();
      if (!blocks.length) return;
      this.idx = Math.max(0, Math.min(blocks.length - 1, this.idx + delta));
      this.seg = 0;
      this.silence();
      if (this.state === 'playing') this.run(++this.token);
      else { this.highlight(blocks[this.idx]); this.emit(); }
    }

    /* Đổi tốc độ khi đang đọc: đọc lại câu hiện tại với tốc độ mới */
    restartSegment() {
      if (this.state !== 'playing') return;
      this.silence();
      this.run(++this.token);
    }

    destroy() { this.stop(); }

    silence() {
      if (this.endResolve) { const r = this.endResolve; this.endResolve = null; r(); }
      try { synth().cancel(); } catch (e) { /* bỏ qua */ }
    }

    highlight(b) {
      if (this.current && this.current !== b) this.current.classList.remove('rf-speaking');
      this.current = b;
      if (!b) return;
      b.classList.add('rf-speaking');
      if (this.s.ttsAutoScroll) {
        const r = b.getBoundingClientRect(), v = this.scrollEl.getBoundingClientRect();
        if (r.top < v.top + 70 || r.bottom > v.bottom - 110) b.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    /* ---------- Chọn văn bản cần đọc: bản gốc hay bản dịch ---------- */

    async textFor(b, token) {
      const original = () => {
        const o = b.querySelector(':scope > .rf-orig');
        const langEl = b.closest('[lang]');
        return { text: (o || b).textContent.replace(/\s+/g, ' ').trim(), lang: (langEl && langEl.lang) || document.documentElement.lang || '' };
      };
      const translated = () => {
        const tr = b.querySelector(':scope > .rf-tr');
        if (!tr || b.__rfState !== 'done') return null;
        return { text: tr.textContent.replace(/\s+/g, ' ').trim(), lang: tr.lang || RFTranslator.langCode(this.s.trTargetLang) };
      };
      const src = this.s.ttsSource;
      if (src === 'original') return original();
      const ready = translated();
      if (ready && ready.text) return ready; // đoạn đã có bản dịch thì đọc bản dịch
      const wantTr = src === 'translation' || this.translatorState().mode !== 'off';
      if (!wantTr) return original();
      // Chờ bản dịch của đoạn này; đoạn đang đọc được cuộn tới nên sẽ được dịch
      const t0 = Date.now();
      let waiting = false;
      while (token === this.token) {
        const t = translated();
        if (t && t.text) { if (waiting) this.emit(); return t; }
        const st = this.translatorState();
        if (b.__rfState === 'error' || st.mode === 'off' || st.paused || Date.now() - t0 > 60000) return original();
        if (!waiting) { waiting = true; this.emit({ note: rfT('ttsWaitingTr') }); }
        await sleep(300);
      }
      return null;
    }

    /* ---------- Vòng đọc ---------- */

    async run(token) {
      this.emit();
      while (token === this.token) {
        let blocks = this.blocks();
        if (this.idx >= blocks.length) {
          this.emit({ note: rfT('ttsWaitingPage') });
          const more = await this.needMore();
          if (token !== this.token) return;
          blocks = this.blocks();
          if (!more || this.idx >= blocks.length) {
            this.state = 'idle';
            this.highlight(null);
            this.idx = Math.max(0, blocks.length - 1);
            this.emit({ note: rfT('ttsEnd') });
            return;
          }
          this.emit();
        }
        const b = blocks[this.idx];
        this.highlight(b);
        const t = await this.textFor(b, token);
        if (token !== this.token) return;
        if (!t || !t.text) { this.idx++; this.seg = 0; continue; }
        const voice = await pickVoice(t.lang, this.s.ttsVoices);
        if (token !== this.token) return;
        if (!voice) {
          this.state = 'paused';
          this.token++;
          this.emit({ error: rfT('ttsNoVoice', t.lang || '?') });
          return;
        }
        const parts = splitText(t.text, t.lang);
        for (; this.seg < parts.length; this.seg++) {
          if (token !== this.token) return;
          try {
            await this.say(parts[this.seg], voice, token);
          } catch (e) {
            if (token !== this.token) return;
            this.state = 'paused';
            this.token++;
            this.emit({ error: rfT('ttsError', e.message || String(e)) });
            return;
          }
        }
        if (token !== this.token) return;
        this.idx++;
        this.seg = 0;
      }
    }

    async say(text, voice, token) {
      await sleep(40); // Chrome đôi khi bỏ qua lệnh speak() gọi ngay sau cancel()
      if (token !== this.token) return;
      await new Promise((resolve, reject) => {
        const U = Utterance();
        const u = new U(text);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = +this.s.ttsRate || 1;
        this.utter = u; // giữ tham chiếu để Chrome không thu gom mất sự kiện onend
        this.endResolve = resolve;
        u.onend = () => { if (this.endResolve === resolve) this.endResolve = null; resolve(); };
        u.onerror = (e) => {
          if (this.endResolve === resolve) this.endResolve = null;
          if (e.error === 'interrupted' || e.error === 'canceled') resolve(); else reject(new Error(e.error || 'speech'));
        };
        synth().speak(u);
      });
    }
  }

  return { Speaker, splitText, getVoices, pickVoice, baseLang };
})();
