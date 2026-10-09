/* Reader Flow — xuất DOM bài đang đọc thành Markdown, không tải media về máy. */
globalThis.RFMarkdown = (() => {
  const SKIP = new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SOURCE', 'TRACK', 'INPUT', 'SELECT']);
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'PRE', 'HR', 'DETAILS', 'VIDEO', 'AUDIO', 'IFRAME', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const esc = (s) => (s || '').replace(/\\/g, '\\\\').replace(/([*_`\[\]<>])/g, '\\$1').replace(/\s+/g, ' ');
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const href = (raw, base) => {
    if (!raw || !String(raw).trim()) return '';
    try {
      const u = new URL(raw, base);
      return /^https?:$/.test(u.protocol) ? u.href.replace(/\)/g, '%29') : '';
    } catch (e) { return ''; }
  };
  const link = (text, url) => url ? `[${esc(text)}](${url})` : esc(text);

  function inline(node, ctx) {
    if (node.nodeType === 3) return esc(node.nodeValue);
    if (node.nodeType !== 1 || SKIP.has(node.tagName)) return '';
    const c = node.classList;
    if (c.contains('rf-ctx') || c.contains('rf-seam') || c.contains('rf-borrowed-tools') || c.contains('rf-retry')) return '';
    if (c.contains('rf-tr-media') && ctx.omitTrMedia) return '';
    if (c.contains('rf-has-tr')) {
      const orig = node.querySelector(':scope > .rf-orig');
      const tr = node.querySelector(':scope > .rf-tr');
      const source = orig ? children(orig, ctx) : '';
      const done = node.__rfState === 'done' && tr && !tr.classList.contains('rf-tr-error') && !tr.classList.contains('rf-tr-pending');
      if (!done || ctx.mode === 'off') return source;
      const translated = children(tr, { ...ctx, omitTrMedia: ctx.mode === 'bilingual' }).trim();
      if (!translated) return source;
      if (ctx.mode === 'replace') return translated;
      return `${source}\n\n> ${translated.replace(/\n/g, '\n> ')}`;
    }
    const tag = node.tagName;
    if (tag === 'BR') return '  \n';
    if (tag === 'IMG') {
      const alt = clean(node.getAttribute('alt')) || ctx.labels.image || 'Image';
      const url = href(node.getAttribute('src'), ctx.url);
      return url ? `![${esc(alt)}](${url})` : link(`${ctx.labels.image || 'Image'}: ${alt}`, href(ctx.url, ctx.url));
    }
    if (tag === 'VIDEO' || tag === 'AUDIO' || tag === 'IFRAME') {
      const title = tag === 'AUDIO' ? (ctx.labels.audio || 'Listen to audio') : (ctx.labels.video || 'Watch video');
      const sources = [node.getAttribute('src'), ...[...node.querySelectorAll('source')].map((el) => el.getAttribute('src')), node.getAttribute('data-rf-hls')];
      const url = sources.map((src) => href(src, ctx.url)).find(Boolean) || href(ctx.url, ctx.url);
      const poster = tag === 'VIDEO' ? href(node.getAttribute('poster'), ctx.url) : '';
      return (poster ? `![${esc(ctx.labels.videoPoster || 'Video poster')}](${poster})\n\n` : '') + link(title, url);
    }
    if (tag === 'A') return link(clean(node.textContent) || node.getAttribute('href') || '', href(node.getAttribute('href'), ctx.url));
    const body = children(node, ctx);
    if (tag === 'STRONG' || tag === 'B') return body.trim() ? `**${body.trim()}**` : '';
    if (tag === 'EM' || tag === 'I') return body.trim() ? `*${body.trim()}*` : '';
    if (tag === 'S' || tag === 'DEL') return body.trim() ? `~~${body.trim()}~~` : '';
    if (tag === 'CODE') {
      const code = node.textContent || '';
      const fence = code.includes('`') ? '``' : '`';
      return `${fence}${code}${fence}`;
    }
    return body;
  }

  function children(node, ctx) { return [...node.childNodes].map((n) => inline(n, ctx)).join(''); }

  function block(node, ctx) {
    if (node.nodeType === 3) return clean(node.nodeValue) ? esc(clean(node.nodeValue)) : '';
    if (node.nodeType !== 1 || SKIP.has(node.tagName)) return '';
    const c = node.classList;
    if (c.contains('rf-ctx') || c.contains('rf-seam') || c.contains('rf-borrowed-tools')) return '';
    const tag = node.tagName;
    if (/^H[1-6]$/.test(tag)) return '#'.repeat(+tag[1]) + ' ' + inline(node, ctx).trim();
    if (tag === 'P' || tag === 'FIGCAPTION') return inline(node, ctx).trim();
    if (tag === 'PRE') {
      const code = (node.textContent || '').replace(/\n+$/, '');
      const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((m) => m[0].length + 1)));
      return `${fence}\n${code}\n${fence}`;
    }
    if (tag === 'HR') return '---';
    if (tag === 'BLOCKQUOTE') return blocks(node, ctx).split('\n').map((line) => `> ${line}`).join('\n');
    if (tag === 'UL' || tag === 'OL') return [...node.children].filter((el) => el.tagName === 'LI').map((li, i) => {
      const nested = [...li.children].filter((el) => el.tagName === 'UL' || el.tagName === 'OL');
      const body = li.classList.contains('rf-has-tr') ? inline(li, ctx).trim()
        : [...li.childNodes].filter((n) => !nested.includes(n)).map((n) => inline(n, ctx)).join('').trim();
      const prefix = tag === 'OL' ? `${i + (+node.getAttribute('start') || 1)}. ` : '- ';
      const indented = body.split('\n').map((line, j) => j && line ? '  ' + line : line).join('\n');
      return prefix + indented + (nested.length ? '\n' + nested.map((el) => block(el, ctx).split('\n').map((l) => '  ' + l).join('\n')).join('\n') : '');
    }).join('\n');
    if (tag === 'TABLE') {
      const rows = [...node.querySelectorAll('tr')].map((tr) => [...tr.children].filter((el) => el.tagName === 'TH' || el.tagName === 'TD').map((el) => inline(el, ctx).replace(/\n\n> /g, ' / ').replace(/\s*\n\s*/g, ' ').trim().replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r) => '| ' + Array.from({ length: width }, (_, i) => r[i] || '').join(' | ') + ' |';
      return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
    }
    if (c.contains('rf-media-missing')) {
      const poster = node.querySelector('img');
      const linkEl = node.querySelector('a[href]');
      const parts = [];
      if (poster) parts.push(inline(poster, ctx));
      parts.push(link(ctx.labels.video || 'Watch video', href(linkEl && linkEl.getAttribute('href'), ctx.url) || href(ctx.url, ctx.url)));
      return parts.filter(Boolean).join('\n\n');
    }
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'AUDIO' || tag === 'IFRAME') return inline(node, ctx);
    if (tag === 'DETAILS' && c.contains('rf-transcript')) {
      const summary = node.querySelector('summary');
      return `### ${esc(clean(summary && summary.textContent) || ctx.labels.transcript || 'Transcript')}\n\n` + [...node.children].filter((el) => el !== summary).map((el) => block(el, ctx)).filter(Boolean).join('\n\n');
    }
    return [...node.children].some((el) => BLOCK.has(el.tagName)) ? blocks(node, ctx) : inline(node, ctx).trim();
  }

  function blocks(node, ctx) { return [...node.childNodes].map((n) => block(n, ctx)).filter(Boolean).join('\n\n'); }

  function render(pages, mode, labels = {}) {
    const parts = [];
    pages.forEach((page, i) => {
      const art = page.section && page.section.querySelector('.rf-article');
      if (!art) return;
      const title = clean(page.title) || clean(page.section.querySelector('h1')?.textContent);
      const heading = i === 0 ? `# ${esc(title)}` : `## ${esc(title && title !== pages[0].title ? title : (labels.page ? labels.page(i + 1) : `Page ${i + 1}`))}`;
      const source = href(page.url, page.url);
      const byline = i === 0 && page.section.querySelector('.rf-byline') ? esc(clean(page.section.querySelector('.rf-byline').textContent)) : '';
      parts.push([heading, `${labels.source || 'Source'}: ${source}`, byline, blocks(art, { url: page.url, mode, labels })].filter(Boolean).join('\n\n'));
    });
    return parts.join('\n\n---\n\n').trim() + '\n';
  }

  function filename(title) {
    const name = clean(title).replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/[.\s-]+$/g, '').slice(0, 100).trim();
    return (name || 'reader-flow') + '.md';
  }

  return { render, filename };
})();
