/* Reader Flow — dịch bằng LLM chạy local.
 *
 * Đơn vị dịch mặc định là CẢ TRANG: mọi đoạn của một trang được gửi trong một yêu cầu, bọc
 * trong <s1>…</s1>, <s2>…</s2>… để mô hình đọc trọn ngữ cảnh rồi trả về đúng từng đoạn.
 * Trang quá dài được cắt thành vài phần liên tiếp, phần sau nhận đoạn cuối của phần trước.
 *
 * Trước khi dịch trang N, extension tạo (hoặc lấy lại) BẢN TÓM TẮT CỘNG DỒN của các trang
 * 1..N-1 kèm bảng thuật ngữ, rồi đưa vào prompt làm thông tin nền.
 */
globalThis.RFTranslator = (() => {
  const BLOCK_SEL = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, dt, dd, summary';
  const TAGGED_INLINE = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'INS', 'SUB', 'SUP', 'CODE', 'MARK', 'SMALL', 'ABBR', 'Q', 'CITE', 'KBD', 'TIME', 'DFN', 'VAR', 'SAMP', 'BIG']);
  const TRANSPARENT = new Set(['SPAN', 'FONT', 'BDI', 'BDO', 'LABEL', 'NOBR', 'WBR']);
  const SUMMARY_SOURCE_CAP = 9000; // số ký tự tối đa của một trang đưa vào bước tóm tắt

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const LANG_CODES = {
    vietnamese: 'vi', 'tiếng việt': 'vi', english: 'en', japanese: 'ja', '日本語': 'ja', korean: 'ko', '한국어': 'ko',
    chinese: 'zh-Hans', 'simplified chinese': 'zh-Hans', 'traditional chinese': 'zh-Hant', french: 'fr', german: 'de',
    spanish: 'es', portuguese: 'pt', italian: 'it', russian: 'ru', thai: 'th', indonesian: 'id', malay: 'ms'
  };
  const langCode = (name) => LANG_CODES[(name || '').trim().toLowerCase()] || '';
  const stripThink = (s) => s.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/^\s*<\/think>/i, '');
  const stripFences = (s) => s.replace(/^\s*```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  const plain = (s) => s.replace(/<[^>]*>/g, '').replace(/<[^>]*$/, '');

  function rubyBase(el) {
    let t = '';
    for (const c of el.childNodes) {
      if (c.nodeType === 3) t += c.nodeValue;
      else if (c.nodeType === 1 && c.tagName !== 'RT' && c.tagName !== 'RP') t += c.textContent;
    }
    return t;
  }

  /* Đoạn HTML -> chuỗi có thẻ giữ chỗ <t1>…</t1>, <m2></m2>. counter dùng chung cả phần dịch
   * để số thẻ không trùng giữa các đoạn. */
  function serialize(root, counter) {
    counter = counter || { n: 0 };
    const map = [];
    let used = 0;
    const walk = (node) => {
      let out = '';
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { out += esc(c.nodeValue); continue; }
        if (c.nodeType !== 1) continue;
        const t = c.tagName;
        if (t === 'RUBY') { out += esc(rubyBase(c)); continue; }
        if (TRANSPARENT.has(t)) { out += walk(c); continue; }
        const id = ++counter.n;
        used++;
        if (TAGGED_INLINE.has(t) && c.textContent.trim()) {
          map[id] = { kind: 't', el: c.cloneNode(false) };
          out += `<t${id}>` + walk(c) + `</t${id}>`;
        } else {
          map[id] = { kind: 'm', el: c.cloneNode(true) };
          out += `<m${id}></m${id}>`;
        }
      }
      return out;
    };
    const text = walk(root).replace(/\s+/g, ' ').trim();
    return { text, map, hasTags: used > 0 };
  }

  function wrapMedia(el) {
    if (el.tagName === 'BR') return el;
    const s = document.createElement('span');
    s.className = 'rf-tr-media';
    s.append(el);
    return s;
  }

  /* Dựng lại DOM từ bản dịch: chỉ tạo text node và bản sao phần tử gốc -> an toàn. */
  function rebuild(str, map) {
    const tpl = document.createElement('template');
    tpl.innerHTML = str;
    const frag = document.createDocumentFragment();
    const used = new Set();
    const conv = (node, parent) => {
      for (const c of [...node.childNodes]) {
        if (c.nodeType === 3) { parent.append(c.nodeValue); continue; }
        if (c.nodeType !== 1) continue;
        const m = /^([tm])(\d+)$/i.exec(c.tagName);
        const info = m && map[+m[2]];
        if (info && info.kind === 't') {
          const shell = info.el.cloneNode(false);
          conv(c, shell);
          parent.append(shell);
        } else if (info && info.kind === 'm') {
          if (!used.has(+m[2])) parent.append(wrapMedia(info.el.cloneNode(true)));
          used.add(+m[2]);
          conv(c, parent); // mô hình viết <m1/> -> phần sau bị lọt vào trong
        } else conv(c, parent);
      }
    };
    conv(tpl.content, frag);
    map.forEach((info, id) => {
      if (info && info.kind === 'm' && !used.has(id) && info.el.tagName !== 'BR') frag.append(wrapMedia(info.el.cloneNode(true)));
    });
    return frag;
  }

  /* Mô hình nhỏ hay viết lệch thẻ: [s1>, <s1], ＜s1＞, 【s1】, < /s 1 >, "s1>" đầu dòng… -> đưa về <s1>. */
  function normalizeTags(text) {
    return text
      .replace(/[<\[＜【〈《]\s*(\/?)\s*([smt])\s*(\d{1,4})\s*(\/?)\s*[>\]＞】〉》]/gi, (m, a, k, n, b) => `<${a}${k.toLowerCase()}${n}${b}>`)
      .replace(/(^|\n)\s*(\/?)s(\d{1,4})>/g, (m, pre, a, n) => `${pre}<${a}s${n}>`);
  }

  /* Tách đầu ra dạng <s1>…</s1><s2>… (kể cả khi đang stream dở). */
  function parseSegments(text) {
    const out = [];
    const re = /<s(\d+)>([\s\S]*?)(?=<\/s\1>|<s\d+>|$)(<\/s\1>)?/gi;
    let m;
    while ((m = re.exec(text))) {
      out.push({ n: +m[1], content: m[2].trim(), closed: !!m[3] });
      if (m[0].length === 0) re.lastIndex++;
    }
    for (let i = 0; i < out.length - 1; i++) out[i].closed = true; // đã sang đoạn sau
    return out;
  }

  /* Các khối chữ "lá" dùng chung cho dịch và đọc to. */
  function readableBlocks(root) {
    return [...root.querySelectorAll(BLOCK_SEL)].filter((b) => {
      if (b.closest('pre, code, .rf-tr, .rf-seam, .rf-ctx, .rf-sitename, .rf-byline, .rf-transcript')) return false;
      if (b.querySelector(BLOCK_SEL)) return false;
      const t = b.textContent.replace(/\s+/g, ' ').trim();
      return t.length >= 2 && /[\p{L}]/u.test(t);
    });
  }

  /* Hồ sơ mô hình: mô hình chuyên dịch không dùng system prompt và cần tham số riêng. */
  function profileOf(s) {
    if (s.trProfile && s.trProfile !== 'auto') return s.trProfile;
    const m = (s.trModel || '').toLowerCase();
    if (/hy-?mt|hunyuan-?mt/.test(m)) return 'hymt';
    if (/translategemma/.test(m)) return 'tgemma';
    return 'generic';
  }

  function samplingFor(profile, s) {
    if (profile === 'hymt') return { temperature: 0.7, top_p: 0.6, top_k: 20, repeat_penalty: 1.05 };
    return { temperature: +s.trTemperature };
  }

  function backgroundText(ctx, lang) {
    const parts = [];
    if (ctx.title) parts.push(`Document title: ${ctx.title}`);
    if (ctx.summary) parts.push(`Summary of the previous pages and glossary (already in ${lang}):\n${ctx.summary}`);
    if (ctx.prev) parts.push(`The text just before this part, with its translation:\nSource: ${ctx.prev.src}\nTranslation: ${ctx.prev.tr}`);
    return parts.join('\n\n');
  }

  function translateMessages(s, profile, segText, ctx, count) {
    const lang = s.trTargetLang || RF_LOCALE_TARGET[rfI18n.lang] || 'English';
    const bg = backgroundText(ctx, lang);
    if (profile === 'generic') {
      const system = [
        `You are a professional literary translator. Translate the document segments given by the user into ${lang}.`,
        'Rules:',
        `- The input contains ${count} segment${count > 1 ? 's' : ''} <s1>…</s1>${count > 1 ? `…<s${count}>…</s${count}>` : ''} that together form one continuous page. Read all of it first so meaning, pronouns, forms of address, names and terminology stay consistent across segments.`,
        '- Output every segment in the same order, each wrapped in the same <sN>…</sN> tags. Do not merge, split, skip or add segments.',
        '- Inside segments, keep placeholder tags like <t1>…</t1> and <m2></m2> exactly as written, around the matching translated words.',
        '- The background information is context only: never translate or repeat it. Follow its glossary for names and recurring terms.',
        '- Output only the translated segments, with no explanations.'
      ].join('\n');
      const user = (bg ? `[Background information]\n${bg}\n\n` : '') + `[Segments to translate]\n${segText}`;
      return [{ role: 'system', content: system }, { role: 'user', content: user }];
    }
    // Hy-MT2 / TranslateGemma: một tin nhắn user, theo mẫu "Background" + "Structured data" của Hy-MT2
    const user = (bg ? `[Background Information]\n${bg}\n\n` : '') + [
      '### Task',
      `Translate the user-facing text within the following XML data into ${lang}, taking the background information into consideration. The segments form one continuous page: keep meaning, names, pronouns and terminology consistent.`,
      '### Strict Rules',
      '1. Structure Preservation: You MUST keep every <sN> segment tag and every placeholder tag (<t1>…</t1>, <m2></m2>) exactly as written, in the same order.',
      '2. Selective Translation: Translate ONLY the visible text.',
      '3. Output only the translated XML, without any additional explanation.',
      '### Source Data',
      segText
    ].join('\n');
    return [{ role: 'user', content: user }];
  }

  function summaryMessages(s, prevSummary, pageText, pageNo, title) {
    const lang = s.trTargetLang || RF_LOCALE_TARGET[rfI18n.lang] || 'English';
    const system = [
      'You maintain a running summary of a document that is being translated page by page. A translator will read your summary before translating the next page.',
      `Write in ${lang}. Output exactly two parts and nothing else:`,
      '1. "Summary:" at most 150 words covering the main content so far, who the people or characters are, their relationships and how they address each other, and the tone or register of the text.',
      `2. "Glossary:" up to 20 lines "source term = ${lang} rendering" for names and recurring terms. Keep earlier glossary entries unchanged unless they were wrong.`
    ].join('\n');
    const user = [
      title ? `Document title: ${title}` : '',
      prevSummary ? `Current summary (pages 1–${pageNo - 1}):\n${prevSummary}` : 'There is no summary yet; this is the first page.',
      `Text of page ${pageNo}:\n${pageText}`,
      'Write the updated summary and glossary.'
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }

  class Translator {
    constructor({ scrollRoot, getSettings, getTitle, onStatus }) {
      this.getSettings = getSettings;
      this.getTitle = getTitle || (() => '');
      this.onStatus = onStatus || (() => {});
      this.sections = [];
      this.queue = [];
      this.current = null;
      this.reqs = new Map();
      this.seq = 0;
      this.gen = 0;
      this.active = false; // đang dịch hay đã dừng
      this.cache = new Map();
      this.summaryCache = [];     // idx -> tóm tắt trang 1..idx+1
      this.summaryInflight = [];  // idx -> Promise
      this.summarizing = 0;
      this.errors = 0;
      this.visible = new Set();
      this.port = null;
      this.io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const sec = e.target.__rfSec;
          if (!sec) continue;
          if (e.isIntersecting) { sec.visibleBlocks.add(e.target); this.visible.add(sec); this.want(sec); }
          else { sec.visibleBlocks.delete(e.target); if (!sec.visibleBlocks.size) this.visible.delete(sec); }
        }
      }, { root: scrollRoot, rootMargin: '1200px 0px 1600px 0px' });
    }

    get s() { return this.getSettings(); }
    get running() { return this.active; }

    /* ---------- Quản lý trang ---------- */

    addSection(el, idx) {
      const blocks = readableBlocks(el);
      const sec = {
        idx: idx != null ? idx : this.sections.length, el, blocks, state: 'idle', visibleBlocks: new Set(),
        source: blocks.map((b) => b.textContent.replace(/\s+/g, ' ').trim()).join('\n\n')
      };
      this.sections[sec.idx] = sec;
      for (const b of blocks) { b.__rfSec = sec; this.io.observe(b); }
    }

    want(sec) {
      if (!this.active) return;
      if (sec.state !== 'idle') return;
      if (sec.blocks.every((b) => b.__rfState === 'done')) { sec.state = 'done'; return; }
      sec.state = 'queued';
      this.queue.push(sec);
      this.queue.sort((a, b) => a.idx - b.idx);
      this.pump();
    }

    pump() {
      if (this.current || !this.active) { this.status(); return; }
      const sec = this.queue.shift();
      if (!sec) { this.status(); return; }
      const run = { sec };
      this.current = sec;
      this.currentRun = run;
      this.processSection(sec).finally(() => {
        if (this.currentRun === run) { this.current = null; this.currentRun = null; }
        this.pump();
      });
      this.status();
    }

    async processSection(sec) {
      const gen = this.gen;
      const s = this.s;
      sec.state = 'running';
      sec.__gen = gen;
      const alive = () => gen === this.gen && this.active;
      let summary = '';
      if (s.trUseSummary && sec.idx > 0) {
        this.markWaiting(sec, true);
        summary = await this.summaryUpTo(sec.idx - 1);
        this.markWaiting(sec, false);
        if (!alive()) { this.resetSectionState(sec); return; }
      }
      this.showContext(sec, summary);
      const todo = sec.blocks.filter((b) => b.isConnected && b.__rfState !== 'done');
      const unitPage = s.trUnit !== 'paragraph';
      const chunks = unitPage ? this.makeChunks(todo, Math.max(800, +s.trChunkChars || 4000)) : todo.map((b) => [b]);
      const baseCtx = { title: this.getTitle(), summary };

      if (unitPage) {
        // Dịch tiếp sau khi dừng: lấy các đoạn đã dịch ngay trước làm ngữ cảnh
        const doneBefore = sec.blocks.slice(0, sec.blocks.indexOf(todo[0])).filter((b) => b.__rfState === 'done');
        let prev = doneBefore.length ? this.tailOf(doneBefore) : null;
        for (const chunk of chunks) {
          if (!alive()) break;
          const res = await this.runChunk(chunk, Object.assign({}, baseCtx, { prev }));
          if (!alive()) break;
          // Đoạn nào mô hình bỏ sót thì dịch lại riêng, vẫn giữ ngữ cảnh
          for (const b of res.missing) {
            if (!alive()) break;
            await this.runChunk([b], Object.assign({}, baseCtx, { prev }));
          }
          prev = this.tailOf(chunk);
        }
      } else {
        const limit = Math.max(1, Math.min(8, +s.trConcurrency || 1));
        let i = 0;
        const worker = async () => {
          while (i < chunks.length && alive()) await this.runChunk(chunks[i++], baseCtx);
        };
        await Promise.all(Array.from({ length: Math.min(limit, chunks.length) }, worker));
      }
      if (!alive()) { this.resetSectionState(sec); return; }
      if (gen !== this.gen) return;
      sec.state = sec.blocks.every((b) => b.__rfState === 'done' || !b.isConnected) ? 'done' : 'idle';
    }

    resetSectionState(sec) {
      // cancelAll() đã tự đặt lại trạng thái; chỉ xử lý khi vẫn là lượt chạy hiện tại
      if (sec.state !== 'done' && sec.__gen === this.gen) sec.state = 'idle';
    }

    makeChunks(blocks, budget) {
      const chunks = [];
      let cur = [], size = 0;
      for (const b of blocks) {
        const len = b.textContent.length + 12;
        if (cur.length && size + len > budget) { chunks.push(cur); cur = []; size = 0; }
        cur.push(b); size += len;
      }
      if (cur.length) chunks.push(cur);
      return chunks;
    }

    tailOf(chunk) {
      const last = chunk.slice(-2).filter((b) => b.__rfState === 'done');
      if (!last.length) return null;
      const src = last.map((b) => (b.querySelector(':scope > .rf-orig') || b).textContent.replace(/\s+/g, ' ').trim()).join('\n');
      const tr = last.map((b) => (b.querySelector(':scope > .rf-tr') || {}).textContent || '').join('\n');
      return { src: src.slice(-1200), tr: tr.slice(-1200) };
    }

    markWaiting(sec, on) {
      sec.el.classList.toggle('rf-sec-waiting', on);
      if (on) this.summarizing++; else this.summarizing = Math.max(0, this.summarizing - 1);
      this.status();
    }

    showContext(sec, summary) {
      let box = sec.el.querySelector(':scope > .rf-ctx');
      if (!summary) { if (box) box.remove(); return; }
      if (!box) {
        box = document.createElement('details');
        box.className = 'rf-ctx';
        const sum = document.createElement('summary');
        const body = document.createElement('div');
        box.append(sum, body);
        const anchor = sec.el.querySelector(':scope > .rf-seam, :scope > .rf-page-head');
        if (anchor) anchor.after(box); else sec.el.prepend(box);
      }
      box.querySelector('summary').textContent = rfT('trContext');
      box.querySelector('div').textContent = summary;
    }

    /* ---------- Tóm tắt cộng dồn ---------- */

    summaryUpTo(idx) {
      if (idx < 0) return Promise.resolve('');
      if (this.summaryCache[idx] != null) return Promise.resolve(this.summaryCache[idx]);
      if (this.summaryInflight[idx]) return this.summaryInflight[idx];
      const gen = this.gen;
      const p = (async () => {
        const prev = await this.summaryUpTo(idx - 1);
        const sec = this.sections[idx];
        if (!sec || gen !== this.gen) return prev;
        const s = this.s;
        let src = sec.blocks.filter((b) => b.isConnected)
          .map((b) => (b.querySelector(':scope > .rf-orig') || b).textContent.replace(/\s+/g, ' ').trim()).join('\n\n') || sec.source;
        if (src.length > SUMMARY_SOURCE_CAP) src = src.slice(0, SUMMARY_SOURCE_CAP * 0.7) + '\n[…]\n' + src.slice(-SUMMARY_SOURCE_CAP * 0.3);
        const text = await this.complete(summaryMessages(s, prev, src, idx + 1, this.getTitle()), s.trSummaryModel || s.trModel, true);
        if (gen !== this.gen) return prev;
        if (text == null) return prev; // lỗi hoặc bị huỷ: dịch tiếp với tóm tắt cũ
        const clean = stripThink(text).trim();
        this.summaryCache[idx] = clean || prev;
        return this.summaryCache[idx];
      })().finally(() => { if (this.summaryInflight[idx] === p) this.summaryInflight[idx] = null; });
      this.summaryInflight[idx] = p;
      return p;
    }

    /* Gọi LLM một lần, trả về toàn bộ văn bản (null nếu lỗi/huỷ). */
    complete(messages, model, isSummary) {
      return new Promise((resolve) => {
        const s = this.s;
        const id = ++this.seq;
        this.reqs.set(id, { kind: 'complete', acc: '', resolve, gen: this.gen });
        const profile = isSummary ? 'generic' : profileOf(s);
        const ok = this.post({ type: 'translate', id, cfg: this.cfg(s, model, profile), messages });
        if (!ok) { this.reqs.delete(id); resolve(null); }
      });
    }

    cfg(s, model, profile) {
      return {
        provider: s.trProvider, endpoint: s.trEndpoint, model, apiKey: s.trApiKey,
        noThink: !!s.trNoThink, numCtx: +s.trNumCtx || 0, sampling: samplingFor(profile, s)
      };
    }

    /* ---------- Dịch một phần (một hoặc nhiều đoạn) ---------- */

    runChunk(blocks, ctx) {
      return new Promise((resolve) => {
        const s = this.s;
        const profile = profileOf(s);
        const counter = { n: 0 };
        const segs = [];
        for (const b of blocks) {
          if (!b.isConnected) continue;
          const { orig, tr } = this.ensureWrap(b);
          const ser = serialize(orig, counter);
          if (!ser.text) { b.__rfState = 'done'; continue; }
          b.__rfState = 'running';
          tr.classList.remove('rf-tr-error');
          tr.classList.add('rf-tr-pending');
          tr.textContent = '';
          segs.push({ b, tr, ser, n: segs.length + 1, done: false });
        }
        if (!segs.length) { resolve({ missing: [] }); return; }
        const segText = segs.map((x) => `<s${x.n}>${x.ser.text}</s${x.n}>`).join('\n');
        const key = [profile, s.trModel, s.trTargetLang, segText].join('\u0001');
        const r = { kind: 'chunk', segs, acc: '', resolve, gen: this.gen, key };
        if (this.cache.has(key)) {
          r.acc = this.cache.get(key);
          this.applyOutput(r, true);
          resolve({ missing: this.finishChunk(r) });
          return;
        }
        const id = ++this.seq;
        this.reqs.set(id, r);
        this.status();
        const ok = this.post({
          type: 'translate', id, cfg: this.cfg(s, s.trModel, profile),
          messages: translateMessages(s, profile, segText, ctx, segs.length)
        });
        if (!ok) this.fail(id, r, rfT('errPortFail'));
      });
    }

    applyOutput(r, final) {
      let text = normalizeTags(stripFences(stripThink(r.acc)));
      let parts = parseSegments(text);
      if (!parts.length && r.segs.length === 1) parts = [{ n: 1, content: text.trim(), closed: final }];
      for (const p of parts) {
        const seg = r.segs[p.n - 1];
        if (!seg || seg.done) continue;
        if (p.closed || final) {
          p.content = p.content.replace(/<\/?s\d+>/gi, '').trim();
          if (!p.content) continue;
          seg.done = true;
          seg.tr.classList.remove('rf-tr-pending');
          try { seg.tr.replaceChildren(rebuild(p.content, seg.ser.map)); } catch (e) { seg.tr.textContent = plain(p.content); }
          seg.b.__rfState = 'done';
        } else {
          seg.tr.textContent = plain(p.content);
        }
      }
    }

    /* Kết thúc một phần: trả về các đoạn mô hình bỏ sót (để dịch lại riêng). */
    finishChunk(r) {
      const missing = [];
      for (const seg of r.segs) {
        if (seg.done) continue;
        seg.tr.classList.remove('rf-tr-pending');
        seg.tr.textContent = '';
        seg.b.__rfState = null;
        if (r.segs.length > 1) missing.push(seg.b);
        else this.markError(seg, rfT('trMissing'));
      }
      this.status();
      return missing;
    }

    onMsg(m) {
      const r = this.reqs.get(m.id);
      if (!r) return;
      if (r.gen !== this.gen) { this.reqs.delete(m.id); return; }
      if (m.type === 'delta') {
        r.acc += m.text;
        if (r.kind === 'chunk') this.applyOutput(r, false);
      } else if (m.type === 'done') {
        this.reqs.delete(m.id);
        if (r.kind === 'complete') { r.resolve(r.acc); return; }
        this.applyOutput(r, true);
        if (r.segs.every((x) => x.done)) this.cache.set(r.key, r.acc);
        r.resolve({ missing: this.finishChunk(r) });
      } else if (m.type === 'error') {
        this.fail(m.id, r, m.error);
      }
    }

    fail(id, r, msg) {
      if (!r) return;
      this.reqs.delete(id);
      if (r.kind === 'complete') {
        this.errors++;
        this.lastError = msg;
        r.resolve(null);
        this.status();
        return;
      }
      this.errors++;
      this.lastError = msg;
      for (const seg of r.segs) if (!seg.done) this.markError(seg, msg);
      r.resolve({ missing: [] });
      this.status();
    }

    markError(seg, msg) {
      const { b, tr } = seg;
      tr.classList.remove('rf-tr-pending');
      tr.classList.add('rf-tr-error');
      tr.textContent = '';
      const note = document.createElement('span');
      note.textContent = ' ' + rfT('trFailed', msg) + ' ';
      const btn = document.createElement('button');
      btn.className = 'rf-retry';
      btn.textContent = rfT('trRetry');
      btn.addEventListener('click', () => this.retry(b));
      tr.append(note, btn);
      b.__rfState = 'error';
    }

    async retry(b) {
      if (!this.active) return;
      this.errors = Math.max(0, this.errors - 1);
      const sec = b.__rfSec;
      const summary = sec && sec.idx > 0 ? (this.summaryCache[sec.idx - 1] || '') : '';
      await this.runChunk([b], { title: this.getTitle(), summary });
      this.status();
    }

    /* ---------- Bọc bản gốc / bản dịch ---------- */

    ensureWrap(block) {
      let orig = block.querySelector(':scope > .rf-orig');
      if (!orig) {
        orig = document.createElement('span');
        orig.className = 'rf-orig';
        orig.append(...block.childNodes);
        block.append(orig);
      }
      let tr = block.querySelector(':scope > .rf-tr');
      if (!tr) {
        tr = document.createElement('span');
        tr.className = 'rf-tr';
        block.append(tr);
      }
      const code = langCode(this.s.trTargetLang);
      if (code) tr.lang = code; else tr.removeAttribute('lang');
      block.classList.add('rf-has-tr');
      return { orig, tr };
    }

    unwrap(block) {
      const orig = block.querySelector(':scope > .rf-orig');
      const tr = block.querySelector(':scope > .rf-tr');
      if (tr) tr.remove();
      if (orig) orig.replaceWith(...orig.childNodes);
      block.classList.remove('rf-has-tr');
      block.__rfState = null;
    }

    /* ---------- Điều khiển ---------- */

    cancelAll() {
      this.gen++;
      for (const [id, r] of this.reqs) {
        this.post({ type: 'cancel', id });
        if (r.kind === 'chunk') for (const seg of r.segs) if (!seg.done) this.unwrap(seg.b);
        r.resolve(r.kind === 'chunk' ? { missing: [] } : null);
      }
      this.reqs.clear();
      this.summaryInflight = [];
      for (const sec of this.queue) sec.state = 'idle';
      this.queue = [];
      if (this.current) { this.current.state = 'idle'; this.current = null; this.currentRun = null; }
      for (const sec of this.sections) if (sec) { sec.el.classList.remove('rf-sec-waiting'); if (sec.state !== 'done') sec.state = 'idle'; }
      this.summarizing = 0;
    }

    /* Bắt đầu / tiếp tục dịch phần đang xem và các trang cuộn tới sau đó. */
    start() {
      this.active = true;
      for (const sec of [...this.visible].sort((a, b) => a.idx - b.idx)) this.want(sec);
      this.status();
    }

    /* Dừng dịch: huỷ ngay mọi yêu cầu (dịch và tóm tắt), giữ các đoạn đã dịch xong. */
    stop() {
      this.active = false;
      this.cancelAll();
      this.status();
    }

    /* Xoá mọi bản dịch đã có và dừng. */
    clear() {
      this.active = false;
      this.reset();
    }

    hasTranslations() {
      return this.sections.some((sec) => sec && sec.blocks.some((b) => b.__rfState === 'done'));
    }

    /* Đổi mô hình / ngôn ngữ / cách dịch: xoá bản dịch và tóm tắt cũ rồi dịch lại phần đang xem. */
    reset() {
      this.cancelAll();
      this.cache.clear();
      this.summaryCache = [];
      this.errors = 0;
      this.lastError = null;
      for (const sec of this.sections) {
        if (!sec) continue;
        sec.state = 'idle';
        for (const b of sec.blocks) this.unwrap(b);
        const ctx = sec.el.querySelector(':scope > .rf-ctx');
        if (ctx) ctx.remove();
      }
      if (this.active) for (const sec of [...this.visible].sort((a, b) => a.idx - b.idx)) this.want(sec);
      this.status();
    }

    /* ---------- Kết nối tới service worker ---------- */

    connect() {
      if (this.port) return this.port;
      this.port = chrome.runtime.connect({ name: 'rf-llm' });
      this.port.onMessage.addListener((m) => this.onMsg(m));
      this.port.onDisconnect.addListener(() => {
        this.port = null;
        for (const [id, r] of [...this.reqs]) this.fail(id, r, rfT('errPortLost'));
      });
      return this.port;
    }

    post(msg) {
      try { this.connect().postMessage(msg); return true; } catch (e) { this.port = null; return false; }
    }

    status() {
      let pending = 0;
      const count = (sec) => { for (const b of sec.blocks) if (b.isConnected && b.__rfState !== 'done' && b.__rfState !== 'error') pending++; };
      if (this.current) count(this.current);
      for (const sec of this.queue) count(sec);
      this.onStatus({ pending, errors: this.errors, lastError: this.lastError, active: this.active, summarizing: this.summarizing, any: this.hasTranslations() });
    }

    destroy() {
      this.io.disconnect();
      for (const [id] of this.reqs) this.post({ type: 'cancel', id });
      this.reqs.clear();
      try { this.port && this.port.disconnect(); } catch (e) { /* bỏ qua */ }
      this.port = null;
      this.gen++;
    }
  }

  /* Dịch nhanh một đoạn chữ (dùng cho "Dịch đoạn đã chọn"). */
  function quickTranslate(text, s, ctx, onUpdate) {
    const profile = profileOf(s);
    const segText = '<s1>' + esc(text.trim()) + '</s1>';
    const messages = translateMessages(s, profile, segText, ctx || {}, 1);
    const extract = (acc) => {
      const t = normalizeTags(stripFences(stripThink(acc)));
      const parts = parseSegments(t);
      return plain(parts.length ? parts.map((x) => x.content).join('\n') : t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
    };
    let port = null, finished = false;
    const promise = new Promise((resolve, reject) => {
      let acc = '';
      port = chrome.runtime.connect({ name: 'rf-llm' });
      port.onMessage.addListener((m) => {
        if (finished) return;
        if (m.type === 'delta') { acc += m.text; onUpdate(extract(acc), false); }
        else if (m.type === 'done') { finished = true; const t = extract(acc); onUpdate(t, true); resolve(t); port.disconnect(); }
        else if (m.type === 'error') { finished = true; reject(new Error(m.error)); port.disconnect(); }
      });
      port.onDisconnect.addListener(() => { if (!finished) { finished = true; reject(new Error(rfT('errPortLost'))); } });
      port.postMessage({
        type: 'translate', id: 1, messages,
        cfg: { provider: s.trProvider, endpoint: s.trEndpoint, model: s.trModel, apiKey: s.trApiKey, noThink: !!s.trNoThink, numCtx: +s.trNumCtx || 0, sampling: samplingFor(profile, s) }
      });
    });
    return {
      promise,
      cancel() { if (finished) return; finished = true; try { port.postMessage({ type: 'cancel', id: 1 }); port.disconnect(); } catch (e) { /* bỏ qua */ } }
    };
  }

  return { quickTranslate, Translator, serialize, rebuild, parseSegments, normalizeTags, profileOf, readableBlocks, langCode };
})();
