/* Nhận diện liên kết "trang kế tiếp" bằng nhiều tín hiệu cộng điểm. */
globalThis.RFNext = (() => {
  const NEXT_EXACT = [
    /^(next|next page|next chapter|next part|next post|next article|older posts?|older entries|older|more results|show more|continue|continue reading)$/i,
    /^(trang sau|trang tiếp|trang tiếp theo|trang kế|trang kế tiếp|tiếp theo|tiếp|sau|kế tiếp|chương sau|chương tiếp|chương tiếp theo|chap sau|chap tiếp|bài tiếp|bài tiếp theo|bài sau|xem tiếp|đọc tiếp|phần tiếp|phần tiếp theo|cũ hơn|bài cũ hơn)$/i,
    /^(次へ|次|次のページ|次ページ|次の話|次話|次の記事|次のページへ|次の\d+件|続きを読む|もっと見る|次へ進む)$/,
    /^(下一页|下一頁|下页|下頁|下一章|下一篇|后一页|後一頁|下一节|下一節)$/,
    /^(다음|다음 페이지|다음 글|다음화|다음 장)$/,
    /^(suivant|suivante|page suivante|siguiente|página siguiente|weiter|nächste|nächste seite|vor|avanti|successivo|successiva|próxima|próximo|seguinte|следующая|следующая страница|далее|вперёд|вперед|volgende|nästa|następna|dalej|sonraki|ถัดไป|berikutnya|selanjutnya)$/i
  ];
  const ARROWS_ONLY = /^[\s›»→>⟩❯▶►⇒⟶]+$/;
  const NEXT_PARTIAL = /\bnext\b|trang sau|trang tiếp|tiếp theo|chương sau|次へ|次のページ|下一[页頁章篇]|다음|suivant|siguiente|weiter|nächste|следующ|próxim/i;
  const PREV = /\b(prev|previous|back|newer|first|last|top)\b|trước|đầu tiên|cuối cùng|mới hơn|前へ|前の|最初|最後|上一|首页|尾页|이전|처음|précédent|anterior|zurück|назад|‹|«|←|⟨|❮|◀|◄/i;
  const NEXT_ATTR = /(^|[\s_-])(next|nextpage|next-page|next_page|pagination-next|pager-next|nav-next|btn-next|next-link|nextlink|next-btn|page-next)($|[\s_-])|arrow-right|chevron-right|icon-next/i;
  const BAD_URL = /\/(login|signin|sign-in|register|signup|logout|share|print|cart|search)\b|[?&](replytocom|share|print)=|#comment|\/comment|\/feed\/?$/i;
  const PAGINATION_SEL = [
    '[class*="pagination" i]', '[class*="pager" i]', '[class*="paging" i]', '[class*="pagenav" i]',
    '[class*="page-numbers" i]', '[class*="page-nav" i]', '[class*="pagenavi" i]', '[id*="pagination" i]',
    '[id*="pager" i]', '[class*="nav-links" i]', '[class*="chapter-nav" i]', '[class*="chapter_nav" i]',
    'nav', '[role="navigation"]'
  ].join(',');
  const PAGE_QUERY_KEYS = ['page', 'p', 'pg', 'paged', 'pagenum', 'pageno', 'pn', 'trang', 'seite', 'pagina', 'sayfa', 'strona'];

  const T = (k, ...a) => (typeof rfT === 'function' ? rfT(k, ...a) : k + (a.length ? ' ' + a.join(' ') : ''));
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function docBase(doc, pageUrl) {
    const b = doc.querySelector('base[href]');
    if (b) { try { return new URL(b.getAttribute('href'), pageUrl).href; } catch (e) { /* bỏ qua */ } }
    return pageUrl;
  }

  function normalize(href, base) {
    if (!href) return null;
    const h = href.trim();
    if (!h || h.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(h)) return null;
    try {
      const u = new URL(h, base);
      if (!/^https?:$/.test(u.protocol)) return null;
      u.hash = '';
      return u.href;
    } catch (e) { return null; }
  }

  function siteKey(host) {
    const parts = host.replace(/^www\./, '').split('.');
    if (parts.length <= 2) return parts.join('.');
    const sld = parts[parts.length - 2];
    const tld = parts[parts.length - 1];
    const n = tld.length === 2 && /^(co|com|net|org|gov|edu|ac|ne|or|go|lg|ed|gr)$/.test(sld) ? 3 : 2;
    return parts.slice(-n).join('.');
  }

  function linkText(a) {
    let t = clean(a.textContent);
    if (!t) {
      const img = a.querySelector('img[alt]');
      if (img) t = clean(img.getAttribute('alt'));
    }
    return t;
  }

  function linkLabel(a) {
    return clean([a.getAttribute('aria-label'), a.getAttribute('title')].filter(Boolean).join(' '));
  }

  /* Số trang hiện tại: ưu tiên phần tử "đang chọn" trong khối phân trang, sau đó tới URL. */
  function currentPageNumber(doc, pageUrl) {
    const marks = doc.querySelectorAll('[aria-current="page"], .current, .active, .is-active, .selected, .cur, .on, span.page-numbers, strong');
    for (const el of marks) {
      const t = clean(el.textContent);
      if (/^\d{1,4}$/.test(t) && el.closest(PAGINATION_SEL)) return +t;
    }
    try {
      const u = new URL(pageUrl);
      for (const k of PAGE_QUERY_KEYS) {
        const v = u.searchParams.get(k);
        if (v && /^\d{1,5}$/.test(v)) return +v;
      }
      const m = u.pathname.match(/\/(?:page|trang|p)[\/_-]?(\d{1,5})\/?$/i);
      if (m) return +m[1];
    } catch (e) { /* bỏ qua */ }
    return 1;
  }

  /* URL ứng viên có phải URL hiện tại với đúng một con số được +1 không? */
  function incrementScore(cur, cand) {
    const strip = (u) => { const x = new URL(u); return (x.host + x.pathname.replace(/\/$/, '') + x.search); };
    let a, b;
    try { a = strip(cur); b = strip(cand); } catch (e) { return 0; }
    const pa = a.split(/(\d+)/), pb = b.split(/(\d+)/);
    if (pa.length === pb.length) {
      let diff = -1;
      for (let i = 0; i < pa.length; i++) {
        if (pa[i] === pb[i]) continue;
        if (i % 2 === 0 || diff !== -1) return 0;
        diff = i;
      }
      if (diff === -1) return 0;
      const x = +pa[diff], y = +pb[diff];
      if (y !== x + 1) return 0;
      return x < 1000 ? 45 : 15;
    }
    // Trang 1 không có số: ứng viên thêm "?page=2", "/page/2", "/2", "-2"...
    const removed = b
      .replace(/([?&])(page|p|pg|paged|pagenum|pageno|pn|trang)=2(&|$)/i, (m, s, k, e) => (e ? s : ''))
      .replace(/\/(page|trang|p)[\/_-]?2$/i, '')
      .replace(/[\/_-]2(\.html?|\.php)?$/i, '$1')
      .replace(/[?&]$/, '');
    return removed !== b && removed === a ? 40 : 0;
  }


  /* ---------- Bài viết nhiều phần (Part 1, Part 2… / Phần 1 / 第1回) ---------- */
  const toAscii = (t) => (t || '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
  const PART_RE = /(?:^|[^\p{L}])(?:part|pt|chapter|chap|ch|episode|ep|lesson|tutorial|vol|volume|phan|phần|chuong|chương|tap|tập|bai|bài|ki|kỳ)[\s._\-:#]*(\d{1,3})(?!\d)/iu;
  const PART_CJK = /第\s*(\d{1,3})\s*[回話部章節篇巻课講]/;

  function partNumberIn(text) {
    const t = toAscii(text);
    const m = PART_RE.exec(t) || PART_CJK.exec(t);
    return m ? +m[1] : null;
  }

  function urlPath(u) {
    try { return decodeURIComponent(new URL(u).pathname); } catch (e) { return ''; }
  }

  /* Số phần của bài hiện tại: ưu tiên URL, sau đó tiêu đề. */
  function currentPart(doc, pageUrl) {
    const fromUrl = partNumberIn(urlPath(pageUrl).replace(/[-_/]/g, ' '));
    if (fromUrl != null) return fromUrl;
    const og = doc.querySelector('meta[property="og:title"]');
    const h1 = doc.querySelector('h1');
    for (const t of [og && og.content, h1 && h1.textContent, doc.title]) {
      const n = t && partNumberIn(t);
      if (n != null) return n;
    }
    return null;
  }

  const samePage = (a, b) => {
    try { const x = new URL(a), y = new URL(b); return x.host === y.host && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, ''); } catch (e) { return false; }
  };

  const slugWords = (u) => urlPath(u).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !/^\d+$/.test(w));

  /* Mục lục loạt bài: danh sách có liên kết tới chính trang này -> mục ngay sau nó là phần kế tiếp. */
  function seriesCandidates(doc, cur, base) {
    const out = [];
    for (const self of doc.querySelectorAll('a[href]')) {
      const href = normalize(self.getAttribute('href'), base);
      if (!href || !samePage(href, cur) || !linkText(self)) continue;
      const li = self.closest('li');
      const box = (li && li.parentElement) || self.closest('p, nav, section, div');
      if (!box) continue;
      const links = [...box.querySelectorAll('a[href]')].filter((a) => {
        const u = normalize(a.getAttribute('href'), base);
        return u && linkText(a);
      });
      if (links.length < 3 || links.length > 80) continue;
      const i = links.indexOf(self);
      for (let j = i + 1; j < links.length; j++) {
        const u = normalize(links[j].getAttribute('href'), base);
        if (u && !samePage(u, cur)) { out.push({ a: links[j], inArticle: !!box.closest('article, main, [role="main"]') && !box.closest('nav, header, footer, aside') }); break; }
      }
    }
    return out;
  }

  function find(doc, pageUrl, opts = {}) {
    const visited = opts.visited || new Set();
    const rule = opts.rule || null;
    const base = docBase(doc, pageUrl);
    let cur;
    try { const u = new URL(pageUrl); u.hash = ''; cur = u.href; } catch (e) { return null; }
    const curSite = siteKey(new URL(cur).hostname);
    const cands = new Map();

    const add = (href, score, why) => {
      const url = normalize(href, base);
      if (!url || url === cur || visited.has(url)) return;
      let host;
      try { host = new URL(url).hostname; } catch (e) { return; }
      if (siteKey(host) !== curSite) return;
      if (BAD_URL.test(url)) score -= 60;
      const c = cands.get(url);
      if (!c) cands.set(url, { url, score, hits: 1, why: [why] });
      else {
        c.hits++;
        if (score > c.score) { c.score = score; c.why.unshift(why); } else c.why.push(why);
      }
    };

    // 1) Quy tắc người dùng chọn cho tên miền này
    if (rule && rule.nextSelector) {
      let matches = [];
      try { matches = [...doc.querySelectorAll(rule.nextSelector)]; } catch (e) { /* selector hỏng */ }
      for (const el of matches) {
        const a = el.closest('a[href]') || el.querySelector('a[href]');
        if (!a) continue;
        const exact = rule.nextText && linkText(a) === rule.nextText;
        add(a.getAttribute('href'), exact || matches.length === 1 ? 1000 : 150, T('whyRule'));
      }
    }
    if (rule && rule.nextText) {
      for (const a of doc.querySelectorAll('a[href]')) {
        if (linkText(a) === rule.nextText) add(a.getAttribute('href'), 900, T('whyRuleText'));
      }
    }

    // 2) rel="next"
    for (const l of doc.querySelectorAll('link[rel~="next" i][href]')) add(l.getAttribute('href'), 100, T('whyLinkRel'));

    // 3) Mục lục loạt bài chứa chính trang này
    const series = new Map();
    for (const c of seriesCandidates(doc, cur, base)) series.set(c.a, c);

    // 4) Duyệt các thẻ <a>
    const curNum = currentPageNumber(doc, pageUrl);
    const part = currentPart(doc, pageUrl);
    const curWords = new Set(slugWords(cur));
    for (const a of doc.querySelectorAll('a[href]')) {
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      if (/\bprev\b/.test(rel)) continue;
      const text = linkText(a);
      const label = linkLabel(a);
      const both = clean(text + ' ' + label);
      const attrs = [a.getAttribute('class'), a.id, a.parentElement && a.parentElement.getAttribute('class'), a.parentElement && a.parentElement.id].filter(Boolean).join(' ');
      const inPager = !!a.closest(PAGINATION_SEL);
      let s = 0;
      const why = [];

      if (/\bnext\b/.test(rel)) { s += 90; why.push(T('whyRelNext')); }
      if (text.length <= 40 && NEXT_EXACT.some((r) => r.test(text.replace(/\s*[›»→>]+\s*$/, '').replace(/^\s*[›»→>]+\s*/, '')))) { s += 60; why.push(T('whyText', text)); }
      else if (text && ARROWS_ONLY.test(text)) { s += 25; why.push(T('whyArrow')); }
      else if (both.length <= 60 && NEXT_PARTIAL.test(both)) { s += 30; why.push(T('whyPartial')); }
      if (NEXT_ATTR.test(attrs)) { s += 25; why.push(T('whyClass')); }
      if (label && NEXT_PARTIAL.test(label)) { s += 15; why.push(T('whyAria')); }
      if (text === String(curNum + 1)) { s += 35; why.push(T('whyPageNum', curNum + 1)); }

      const url = normalize(a.getAttribute('href'), base);
      if (url) {
        const inc = incrementScore(cur, url);
        if (inc) { s += inc; why.push(T('whyUrlInc')); }
      }
      // Bài nhiều phần: liên kết tới "phần N+1"
      if (part != null && url) {
        const candPart = partNumberIn(urlPath(url).replace(/[-_/]/g, ' ')) ?? partNumberIn(text) ?? partNumberIn(label);
        if (candPart === part + 1) {
          s += 45; why.push(T('whyPartNext', part + 1));
          if (slugWords(url).some((w) => curWords.has(w))) s += 5;
        }
      }
      const ser = series.get(a);
      if (ser) { s += 40; why.push(T('whySeries')); }
      if (s > 0 && (ser ? ser.inArticle : !!a.closest('article, main, [role="main"]') && !a.closest('nav, header, footer, aside'))) s += 10;
      if (s > 0 && inPager) { s += 15; why.push(T('whyPager')); }
      if (s > 0 && PREV.test(both) && !/\bnext\b/.test(rel)) { s -= 120; why.push(T('whyPrevLike')); }
      if (s > 0) add(a.getAttribute('href'), s, why.join(', '));
    }

    let best = null;
    for (const c of cands.values()) {
      c.total = c.score + Math.min(15, (c.hits - 1) * 5);
      if (!best || c.total > best.total) best = c;
    }
    if (!best || best.total < 50) return null; // chỉ riêng "URL tăng số" là chưa đủ
    return { url: best.url, score: best.total, reason: best.why[0] };
  }

  /* Tạo CSS selector cho phần tử người dùng bấm chọn. */
  function selectorFor(el, doc) {
    doc = doc || el.ownerDocument;
    const ok = (id) => id && !/\d{3,}/.test(id);
    if (ok(el.id)) return '#' + CSS.escape(el.id);
    const parts = [];
    let e = el;
    for (let depth = 0; e && e.nodeType === 1 && depth < 5; depth++, e = e.parentElement) {
      if (e.tagName === 'BODY' || e.tagName === 'HTML') break;
      let part = e.tagName.toLowerCase();
      if (ok(e.id)) { parts.unshift('#' + CSS.escape(e.id)); break; }
      const cls = [...e.classList].filter((c) => !/\d{2,}|active|hover|focus|selected|current|disabled/i.test(c)).slice(0, 2);
      if (cls.length) part += cls.map((c) => '.' + CSS.escape(c)).join('');
      if (depth === 0 && e.getAttribute('rel')) part += '[rel="' + e.getAttribute('rel').replace(/"/g, '') + '"]';
      parts.unshift(part);
      const sel = parts.join(' > ');
      try { if (doc.querySelectorAll(sel).length === 1) return sel; } catch (err) { /* thử tiếp */ }
    }
    return parts.join(' > ');
  }

  return { currentPart, partNumberIn, find, selectorFor, linkText, docBase, normalize, currentPageNumber, incrementScore };
})();
