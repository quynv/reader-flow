/* Trích xuất nội dung chính bằng Readability nhưng giữ lại ảnh, video, audio và các embed. */
globalThis.RFExtract = (() => {
  const EMBED_RE = /\/\/([\w-]+\.)*(rf-media\.invalid|youtube(-nocookie)?\.com|youtu\.be|vimeo\.com|dailymotion\.com|dai\.ly|soundcloud\.com|spotify\.com|twitch\.tv|tiktok\.com|bilibili\.com|nicovideo\.jp|nico\.ms|streamable\.com|facebook\.com\/plugins\/video|ted\.com|bandcamp\.com|podcasts\.apple\.com|loom\.com|wistia\.(com|net)|jwplayer\.com|brightcove\.net|vk\.com\/video_ext|rumble\.com|odysee\.com|archive\.org\/embed|codepen\.io|google\.com\/maps)/i;
  const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-actualsrc', 'data-hi-res-src', 'data-echo', 'data-orig-file', 'data-full-src', 'data-large-file', 'data-img-src', 'data-image'];
  const PLACEHOLDER_SRC = /^data:|blank\.|placeholder|spacer|lazy|loading|1x1|pixel\.|transparent|grey\.gif|empty\./i;
  const JUNK_IMG = /logo|icon|avatar|sprite|emoji|badge|button|banner|\/ads?[\/_-]|doubleclick|pixel|spacer|1x1|tracking|gravatar/i;
  const AD_CONTAINER = /(^|\s)(ad|ads|advert|advertisement|sponsor|sponsored|promo|banner-ad|dfp)(\s|$|[-_])/i;

  function abs(u, base) {
    if (!u) return u;
    const t = u.trim();
    if (/^(data|blob|javascript):/i.test(t)) return t;
    try { return new URL(t, base).href; } catch (e) { return t; }
  }

  function absSrcset(v, base) {
    return v.split(/,\s+/).map((part) => {
      const [u, ...d] = part.trim().split(/\s+/);
      return [abs(u, base), ...d].join(' ');
    }).join(', ');
  }

  function prepare(doc, url) {
    // <base> để Readability và trình duyệt phân giải URL tương đối đúng trang gốc
    let base = doc.querySelector('base[href]');
    if (base) base.setAttribute('href', abs(base.getAttribute('href'), url));
    else {
      base = doc.createElement('base');
      base.setAttribute('href', url);
      (doc.head || doc.documentElement).prepend(base);
    }
    const baseUrl = base.getAttribute('href');

    // Ảnh lazy-load
    for (const img of doc.querySelectorAll('img')) {
      const cur = img.getAttribute('src') || '';
      for (const a of LAZY_ATTRS) {
        const v = img.getAttribute(a);
        if (v && !/^data:/i.test(v) && /[\/.]/.test(v) && (!cur || PLACEHOLDER_SRC.test(cur))) {
          img.setAttribute('src', v);
          break;
        }
      }
      const ds = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset');
      if (ds && (!img.getAttribute('srcset') || PLACEHOLDER_SRC.test(img.getAttribute('srcset')))) img.setAttribute('srcset', ds);
    }
    for (const s of doc.querySelectorAll('source[data-srcset], source[data-src]')) {
      if (s.getAttribute('data-srcset')) s.setAttribute('srcset', s.getAttribute('data-srcset'));
      if (s.getAttribute('data-src')) s.setAttribute('src', s.getAttribute('data-src'));
    }
    for (const f of doc.querySelectorAll('iframe[data-src], iframe[data-lazy-src]')) {
      if (!f.getAttribute('src') || f.getAttribute('src') === 'about:blank') f.setAttribute('src', f.getAttribute('data-src') || f.getAttribute('data-lazy-src'));
    }

    // URL tuyệt đối cho media
    for (const el of doc.querySelectorAll('img, source, video, audio, iframe, track, embed')) {
      for (const at of ['src', 'poster']) if (el.hasAttribute(at)) el.setAttribute(at, abs(el.getAttribute(at), baseUrl));
      if (el.hasAttribute('srcset')) el.setAttribute('srcset', absSrcset(el.getAttribute('srcset'), baseUrl));
    }
    return baseUrl;
  }

  function isInAdOrChrome(el) {
    for (let e = el.parentElement, d = 0; e && d < 8; e = e.parentElement, d++) {
      const tag = e.tagName;
      if (tag === 'NAV' || tag === 'FOOTER' || tag === 'ASIDE') return true;
      const c = (e.getAttribute('class') || '') + ' ' + (e.id || '');
      if (AD_CONTAINER.test(c)) return true;
    }
    return false;
  }

  /* ---------- Video: tìm nguồn thật, thay cả khung player ---------- */

  const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv|m3u8)(\?|#|$)/i;
  const VIDEO_ATTRS = ['data-vid', 'data-video', 'data-video-src', 'data-video-url', 'data-videourl', 'data-src', 'data-url',
    'data-file', 'data-mp4', 'data-hls', 'data-source', 'data-stream', 'data-media', 'data-video-file', 'data-src-mp4', 'data-original'];
  const POSTER_ATTRS = ['poster', 'data-poster', 'data-thumb', 'data-thumbnail', 'data-image', 'data-cover', 'data-img'];
  // Khung của các thư viện player phổ biến (video.js, JW Player, Plyr, MediaElement, Flowplayer, Shaka…)
  const PLAYER_ROOT = '.video-js, .vjs-player, .jwplayer, .jw-wrapper, .plyr, .mejs-container, .mejs__container, .flowplayer, .fp-player, ' +
    '.shaka-video-container, .media-player, .video-player, .videoplayer, [data-player], [type="VideoStream"], [class*="VideoPlayer"], [class*="video-player"], ' +
    '[class*="player" i], [id*="player" i]';
  // Phần điều khiển của player: chữ "Current Time", "Duration", danh sách 720p/480p… nằm ở đây
  const PLAYER_CHROME = '.vjs-control-bar, .vjs-menu, .vjs-menu-button, .vjs-text-track-display, .vjs-loading-spinner, .vjs-big-play-button, ' +
    '.vjs-modal-dialog, .vjs-control-text, .vjs-poster, .vjs-title-bar, .jw-controls, .jw-overlays, .jw-title, .plyr__controls, .mejs-controls, ' +
    '.mejs__controls, .fp-ui, .shaka-controls-container, .shaka-spinner-container';

  function absMedia(v, base) {
    if (!v) return null;
    let t = v.trim();
    if (/^(blob|data|javascript):/i.test(t)) return null;
    if (t.startsWith('//')) t = 'https:' + t;
    else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?\//i.test(t)) { // "kenh14cdn.com/…/abc.mp4": thiếu giao thức
      let proto = 'https:';
      try { proto = new URL(base).protocol; } catch (e) { /* bỏ qua */ }
      t = proto + '//' + t;
    }
    try { return new URL(t, base).href; } catch (e) { return null; }
  }

  function videoUrlFrom(el, base) {
    for (const a of VIDEO_ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && VIDEO_EXT.test(v)) { const u = absMedia(v, base); if (u) return u; }
    }
    return null;
  }

  function posterFrom(el, base) {
    for (const a of POSTER_ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && !/^data:/i.test(v)) { const u = absMedia(v, base); if (u) return u; }
    }
    const img = el.querySelector && el.querySelector('img[src]:not([src^="data:"])');
    return img ? absMedia(img.getAttribute('src'), base) : null;
  }

  /* Khung player bao quanh video, nhưng không được nuốt cả đoạn văn của bài */
  function playerRoot(el) {
    const root = el.closest(PLAYER_ROOT);
    if (!root || root === el) return el;
    if (root.querySelector('p') || root.querySelectorAll('video, audio, iframe').length > 1) return el;
    const clone = root.cloneNode(true);
    clone.querySelectorAll(PLAYER_CHROME + ', script, style').forEach((x) => x.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim().length > 200 ? el : root;
  }

  /* Nguồn dự phòng cho video phát bằng blob: (MediaSource) */
  function pageVideoSources(doc, base, opts) {
    const list = [];
    for (const sc of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const walk = (o) => {
          if (!o || typeof o !== 'object') return;
          if (Array.isArray(o)) return o.forEach(walk);
          const t = [].concat(o['@type'] || []);
          if (t.includes('VideoObject')) {
            const u = absMedia(o.contentUrl || '', base);
            if (u && VIDEO_EXT.test(u)) list.push(u);
          }
          Object.values(o).forEach((v) => typeof v === 'object' && walk(v));
        };
        walk(JSON.parse(sc.textContent));
      } catch (e) { /* JSON hỏng */ }
    }
    for (const m of doc.querySelectorAll('meta[property="og:video:secure_url"], meta[property="og:video:url"], meta[property="og:video"]')) {
      const u = absMedia(m.getAttribute('content'), base);
      if (u && VIDEO_EXT.test(u) && !list.includes(u)) list.push(u);
    }
    // Trang đang mở: những gì player đã thực sự tải (m3u8 / mp4)
    for (const u of opts.resourceUrls || []) if (!list.includes(u)) list.push(u);
    return list;
  }

  function videoHtml(src, poster) {
    const hls = /\.m3u8(\?|#|$)/i.test(src);
    const p = poster ? ` poster="${escAttr(poster)}"` : '';
    return hls
      ? `<video controls preload="none" data-rf-hls="${escAttr(src)}"${p}></video>`
      : `<video controls preload="metadata"${p}><source src="${escAttr(src)}"></video>`;
  }

  /* Trang đang mở: đánh dấu video/khung thay thế bằng số thứ tự của thẻ <video> thật (data-rf-vid),
   * để chế độ đọc có thể "mượn" chính player của trang khi không tự phát được. */
  /* iframe player được trang điều khiển qua postMessage (vd. BBC SMP: …/iframe.html không có tham số):
   * mở lại một bản mới sẽ trống trơn, phải dùng đúng iframe đang sống của trang */
  function isSelfContained(src) {
    if (EMBED_RE.test(src)) return true;
    try {
      const u = new URL(src);
      if (u.search.length > 1) return true;
      return /[\/=_-](?=[a-z0-9_-]*\d)(?=[a-z0-9_-]*[a-z])[a-z0-9_-]{6,}(?=[\/?#.]|$)/i.test(u.pathname);
    } catch (e) { return false; }
  }

  function markLiveFrame(html, el) {
    if (!/^<div class="rf-embed"/.test(html)) return html;
    const f = el && (el.matches && el.matches('iframe') ? el : el.querySelector && el.querySelector('iframe'));
    if (!f) return html;
    let extra = '';
    if (f.hasAttribute('data-rf-ifr')) extra += ` data-rf-live-frame="${escAttr(f.getAttribute('data-rf-ifr'))}"`;
    if (!isSelfContained(f.getAttribute('src') || '')) extra += ' data-rf-controlled="1"';
    return extra ? html.replace(/^<div class="rf-embed"/, '<div class="rf-embed"' + extra) : html;
  }

  function markLive(html, el) {
    const v = el && (el.matches && el.matches('[data-rf-vid]') ? el : el.querySelector && el.querySelector('[data-rf-vid]'));
    if (!v) return html;
    return html.replace(/^<(video|div)\b/, `<$1 data-rf-live="${escAttr(v.getAttribute('data-rf-vid'))}"`);
  }

  /* <video><source src="https://www.youtube.com/watch?v=…"> (MediaElement, Plyr…) -> iframe nhúng */
  function embedFromUrl(u) {
    if (!u) return null;
    let m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i.exec(u);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    m = /vimeo\.com\/(?:video\/)?(\d{5,})/i.exec(u);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    return null;
  }

  function embedHtml(src) {
    return `<div class="rf-embed" data-rf-ratio="56.25"><iframe src="${escAttr(src)}" allowfullscreen loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen"></iframe></div>`;
  }

  function missingHtml(poster, pageUrl, kind) {
    return `<div class="rf-media-missing">${poster ? `<img src="${escAttr(poster)}" alt="">` : ''}<a href="${escAttr(pageUrl)}" target="_blank" rel="noopener">${escAttr(rfT(kind === 'video' ? 'mediaVideoOnly' : 'mediaAudioOnly'))}</a></div>`;
  }

  const AD_IFRAME = /doubleclick|googlesyndication|googleadservices|adservice|adsystem|adnxs|criteo|taboola|outbrain|teads|facebook\.com\/plugins\/(like|page|comments)|platform\.twitter|disqus|recaptcha|googletagmanager|chat|survey|newsletter|consent/i;
  /* iframe player riêng của trang (BBC, báo, trang khoá học…): cho phép toàn màn hình và là trình phát/nhúng */
  function isPlayerIframe(el, src, pageUrl) {
    if (AD_IFRAME.test(src)) return false;
    const allow = (el.getAttribute('allow') || '') + ' ' + (el.hasAttribute('allowfullscreen') || el.hasAttribute('webkitallowfullscreen') ? 'fullscreen' : '');
    if (!/fullscreen|autoplay|encrypted-media|picture-in-picture/i.test(allow)) return false;
    let same = false;
    try { same = siteOf(new URL(src).hostname) === siteOf(new URL(pageUrl).hostname); } catch (e) { /* bỏ qua */ }
    return same || /embed|player|video|media|watch|play/i.test(src);
  }
  function siteOf(host) {
    const parts = host.replace(/^www\./, '').split('.');
    if (parts.length <= 2 || /^\d+$/.test(parts[parts.length - 1])) return parts.join('.');
    const sld = parts[parts.length - 2], tld = parts[parts.length - 1];
    const n = tld.length === 2 && /^(co|com|net|org|gov|edu|ac|ne|or|go|lg|ed|gr)$/.test(sld) ? 3 : 2; // bbc.co.uk, asahi.co.jp…
    return parts.slice(-n).join('.');
  }

  function mediaHtml(el, pageUrl, ctx) {
    const tag = el.tagName;
    if (tag === 'IFRAME' || tag === 'EMBED') {
      const src = el.getAttribute('src') || '';
      if (!/^https?:/i.test(src)) return null;
      if (!EMBED_RE.test(src) && !isPlayerIframe(el, src, pageUrl)) return null;
      const w = el.getAttribute('width'), h = el.getAttribute('height');
      const ratio = w && h && +w > 0 && +h > 0 ? (+h / +w) : 0.5625;
      return `<div class="rf-embed" data-rf-ratio="${(ratio * 100).toFixed(2)}"><iframe src="${escAttr(src)}" allowfullscreen loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    }
    if (tag === 'VIDEO' || tag === 'AUDIO') {
      const kind = tag === 'VIDEO' ? 'video' : 'audio';
      const srcs = [];
      const own = el.getAttribute('src');
      if (own) srcs.push({ src: own, type: el.getAttribute('type') });
      for (const s of el.querySelectorAll('source[src]')) srcs.push({ src: s.getAttribute('src'), type: s.getAttribute('type') });
      for (const s of srcs) { const e = embedFromUrl(s.src); if (e) return embedHtml(e); }
      let usable = srcs.filter((s) => /^https?:/i.test(s.src));
      const root = ctx.root || el;
      const poster = absMedia(el.getAttribute('poster'), ctx.base) || posterFrom(root, ctx.base);
      if (!usable.length && kind === 'video' && ctx.substack) {
        const sid = substackVideoId(el, root);
        if (sid) return substackVideoHtml(ctx.origin, sid, poster);
      }
      if (!usable.length && kind === 'video') {
        // blob:/không có src -> tìm trong thuộc tính của video và các khung bao quanh, rồi nguồn chung của trang
        let u = videoUrlFrom(el, ctx.base);
        for (let a = el.parentElement, d = 0; !u && a && d < 6; a = a.parentElement, d++) {
          u = videoUrlFrom(a, ctx.base);
          if (a === root) break;
        }
        if (!u && ctx.fallback.length) u = ctx.fallback.shift();
        if (u) return videoHtml(u, poster);
      }
      if (!usable.length) return srcs.length || poster ? missingHtml(poster, pageUrl, kind) : null;
      const tracks = [...el.querySelectorAll('track[src]')].map((t) => `<track kind="${escAttr(t.getAttribute('kind') || 'subtitles')}" src="${escAttr(t.getAttribute('src'))}" srclang="${escAttr(t.getAttribute('srclang') || '')}" label="${escAttr(t.getAttribute('label') || '')}">`).join('');
      if (kind === 'video' && usable.length === 1 && /\.m3u8(\?|#|$)/i.test(usable[0].src)) return videoHtml(usable[0].src, poster);
      const sources = usable.map((s) => `<source src="${escAttr(s.src)}"${s.type ? ` type="${escAttr(s.type)}"` : ''}>`).join('');
      return `<${kind} controls preload="metadata"${poster && kind === 'video' ? ` poster="${escAttr(poster)}"` : ''}>${sources}${tracks}</${kind}>`;
    }
    if (tag === 'PICTURE') {
      const img = el.querySelector('img');
      if (!img || !img.getAttribute('src')) return null;
      return el.outerHTML;
    }
    return null;
  }

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  /* ---------- Bộ chuyển riêng cho từng nền tảng ---------- */

  /* Substack: video/podcast của bài nằm trong player ở đầu trang (ngoài thân bài) và chỉ có trong
   * dữ liệu window._preloads. Nguồn phát: /api/v1/video/upload/<id>/src?type=mp4|hls trên chính domain. */
  function substackPreloads(doc) {
    for (const sc of doc.querySelectorAll('script:not([src])')) {
      const t = sc.textContent;
      const i = t.indexOf('window._preloads');
      if (i < 0) continue;
      const m = /window\._preloads\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(t.slice(i));
      if (m) { try { return JSON.parse(JSON.parse(m[1])); } catch (e) { /* bỏ qua */ } }
    }
    return null;
  }

  function isSubstack(doc, url) {
    try { if (/(^|\.)substack\.com$/.test(new URL(url).hostname)) return true; } catch (e) { /* bỏ qua */ }
    return !!doc.querySelector('link[href*="substackcdn.com"], script[src*="substackcdn.com"], meta[content*="substackcdn.com"]');
  }

  function substackVideoHtml(origin, id, poster) {
    const base = `${origin}/api/v1/video/upload/${encodeURIComponent(id)}/src?type=`;
    return `<video controls preload="metadata" data-rf-alt-hls="${escAttr(base + 'hls')}"${poster ? ` poster="${escAttr(poster)}"` : ''}><source src="${escAttr(base + 'mp4')}" type="video/mp4"></video>`;
  }

  /* Trình phát nhúng mà trang tự khai báo cho mạng xã hội (TED, BBC, nhiều báo…) */
  function playerMetaEmbed(doc, pageUrl) {
    const meta = (sel) => (doc.querySelector(sel) || {}).content || '';
    const ogType = meta('meta[property="og:video:type"]');
    let src = /text\/html/i.test(ogType) ? (meta('meta[property="og:video:secure_url"]') || meta('meta[property="og:video:url"]') || meta('meta[property="og:video"]')) : '';
    let w = +meta('meta[property="og:video:width"]'), h = +meta('meta[property="og:video:height"]');
    if (!src) {
      src = meta('meta[name="twitter:player"], meta[property="twitter:player"]');
      w = +meta('meta[name="twitter:player:width"], meta[property="twitter:player:width"]');
      h = +meta('meta[name="twitter:player:height"], meta[property="twitter:player:height"]');
    }
    if (!/^https?:\/\//i.test(src) || (h && h < 120) || AD_IFRAME.test(src)) return null;
    if (/^http:/i.test(src) && !/^http:/i.test(pageUrl)) return null; // không nhúng http trên trang https
    try { if (new URL(src).href === new URL(pageUrl).href) return null; } catch (e) { return null; }
    const ratio = w > 0 && h > 0 ? (h / w) * 100 : 56.25;
    return `<div class="rf-embed" data-rf-ratio="${ratio.toFixed(2)}"><iframe src="${escAttr(src)}" allowfullscreen loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen"></iframe></div>`;
  }

  /* Bản chép lời Substack (tab "Transcript"): lấy ra khỏi trang để Readability không nhầm là thân bài */
  function takeTranscript(doc, body) {
    let best = null, bestLen = 300;
    for (const el of doc.querySelectorAll('[class*="transcript" i]')) {
      if (body && (el.contains(body) || body.contains(el))) continue;
      const len = el.textContent.replace(/\s+/g, ' ').trim().length;
      if (len > bestLen) { best = el; bestLen = len; }
    }
    if (!best) return '';
    const html = best.innerHTML;
    best.remove();
    return html;
  }

  function substackLead(doc, url) {
    if (!isSubstack(doc, url)) return null;
    let origin;
    try { origin = new URL(url).origin; } catch (e) { return null; }
    const pre = substackPreloads(doc);
    const post = pre && pre.post;
    const og = (doc.querySelector('meta[property="og:image"]') || {}).content || '';
    const poster = /substack-video|video_upload/.test(og) ? og : '';
    // Thân bài thật của Substack; tránh để Readability chọn nhầm bản chép lời dài hơn
    const body = doc.querySelector('.available-content .body.markup, .body.markup, .available-content');
    const out = {
      contentSelector: body && body.textContent.trim().length > 150 ? '.available-content .body.markup, .body.markup, .available-content' : null,
      transcript: takeTranscript(doc, body),
      byline: post && Array.isArray(post.publishedBylines) ? post.publishedBylines.map((b) => b && b.name).filter(Boolean).join(', ') : '',
      published: (post && post.post_date) || ''
    };
    // Podcast dạng video có cả podcast_url (chỉ tiếng) lẫn videoUpload: ưu tiên video
    let id = post && ((post.videoUpload && post.videoUpload.id) || post.video_upload_id ||
      (post.podcastUpload && post.podcastUpload.video_upload_id));
    if (!id) {
      const live = doc.querySelector('video[data-video-id]');
      if (live && UUID_RE.test(live.getAttribute('data-video-id'))) id = live.getAttribute('data-video-id');
    }
    if (!id) {
      const m = /video_upload\/post\/\d+\/([0-9a-f-]{36})\//i.exec(decodeURIComponent(og));
      if (m) id = m[1];
    }
    if (id) {
      const live = [...doc.querySelectorAll('video[data-rf-vid][data-video-id]')].find((v) => v.getAttribute('data-video-id') === id);
      return Object.assign(out, { key: `/api/v1/video/upload/${encodeURIComponent(id)}/src`, html: markLive(substackVideoHtml(origin, id, poster), live) });
    }
    if (post && post.podcast_url) {
      return Object.assign(out, { key: post.podcast_url, html: `<audio controls preload="metadata"><source src="${escAttr(post.podcast_url)}"></audio>` });
    }
    return out.contentSelector || out.transcript ? out : null;
  }

  /* Khối nhúng dạng data-attrs='{"mediaUploadId": …}' (Substack) hoặc '{"videoId": …}' (YouTube). */
  function dataAttrsMedia(el, doc, url) {
    let a;
    try { a = JSON.parse(el.getAttribute('data-attrs') || ''); } catch (e) { return null; }
    if (!a || typeof a !== 'object') return null;
    if (a.mediaUploadId && isSubstack(doc, url)) {
      return substackVideoHtml(new URL(url).origin, a.mediaUploadId, a.thumbnail_url || a.thumbnailUrl || '');
    }
    if (a.videoId && /youtube/i.test((el.getAttribute('class') || '') + ' ' + (el.getAttribute('data-component-name') || ''))) {
      return `<div class="rf-embed" data-rf-ratio="56.25"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(a.videoId)}" allowfullscreen loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen"></iframe></div>`;
    }
    return null;
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /* Mã video Substack của một thẻ <video> đã dựng player: data-video-id, hoặc nằm trong đường dẫn ảnh bìa */
  function substackVideoId(el, root) {
    for (const x of [el, root]) {
      const v = x && x.getAttribute && x.getAttribute('data-video-id');
      if (v && UUID_RE.test(v)) return v;
    }
    const poster = decodeURIComponent((el.getAttribute('poster') || ''));
    const m = /video_upload\/post\/\d+\/([0-9a-f-]{36})\//i.exec(poster);
    return m ? m[1] : null;
  }

  const LEAD_ADAPTERS = [substackLead];

  /* Thay media bằng ký hiệu giữ chỗ để Readability không xoá, rồi gắn lại sau. */
  function stashMedia(doc, pageUrl, opts) {
    const store = [];
    const base = (doc.querySelector('base[href]') || {}).href || pageUrl;
    const put = (el, html) => {
      const i = store.push(markLiveFrame(markLive(html, el), el)) - 1;
      store.anchors = store.anchors || [];
      store.anchors[i] = anchorsOf(el);
      // Ký hiệu giữ chỗ là một iframe có địa chỉ khớp danh sách video của Readability, nên cả khối chứa nó
      // không bị "dọn" dù có nhiều link (vd. khung ví dụ của w3schools). Địa chỉ .invalid không bao giờ được tải.
      const ph = doc.createElement('iframe');
      ph.setAttribute('src', `https://rf-media.invalid/${i}`);
      el.replaceWith(ph);
    };
    // 1) Khối video chưa dựng player (vd. kenh14: <div type="VideoStream" data-vid="kenh14cdn.com/…mp4">)
    const attrSel = VIDEO_ATTRS.map((a) => `[${a}]`).join(',');
    for (const el of [...doc.querySelectorAll(attrSel)]) {
      if (!el.isConnected || /^(IMG|SOURCE|VIDEO|AUDIO|IFRAME|A|SCRIPT|LINK|META)$/.test(el.tagName)) continue;
      if (isInAdOrChrome(el)) continue;
      const u = videoUrlFrom(el, base);
      if (!u) continue;
      const video = el.querySelector('video');
      const root = video ? playerRoot(video) : el;
      const target = root.contains(el) ? root : el;
      put(target, videoHtml(u, (video && absMedia(video.getAttribute('poster'), base)) || posterFrom(el, base)));
    }
    // 1c) Player dạng custom element: <hls-video src="….m3u8">, <mux-player playback-id="…"> …
    for (const el of [...doc.querySelectorAll('*')]) {
      if (!el.isConnected || !el.tagName.includes('-') && !el.hasAttribute('playback-id') && !el.hasAttribute('data-playback-id')) continue;
      const pid = el.getAttribute('playback-id') || el.getAttribute('playbackid') || el.getAttribute('data-playback-id');
      let src = pid ? `https://stream.mux.com/${encodeURIComponent(pid)}.m3u8` : null;
      if (!src) {
        const v = el.getAttribute('src') || '';
        if (/\.(m3u8|mp4|webm|m4v|mov)(\?|#|$)/i.test(v)) src = absMedia(v, base);
      }
      if (!src || isInAdOrChrome(el)) continue;
      // Leo lên khung player bên ngoài (các custom element / khung player không chứa đoạn văn)
      let root = el;
      for (let a = el.parentElement, d = 0; a && d < 6; a = a.parentElement, d++) {
        if (/^(BODY|MAIN|ARTICLE|SECTION)$/.test(a.tagName) || a.querySelector('p')) break;
        if (a.tagName.includes('-') || a.matches(PLAYER_ROOT)) root = a;
      }
      const poster = absMedia(el.getAttribute('poster'), base) || (pid ? `https://image.mux.com/${encodeURIComponent(pid)}/thumbnail.webp` : posterFrom(root, base));
      put(root, videoHtml(src, poster));
    }
    // 1b) Khối nhúng mô tả bằng JSON trong data-attrs (Substack, YouTube của Substack…)
    for (const el of [...doc.querySelectorAll('[data-attrs]')]) {
      if (!el.isConnected || isInAdOrChrome(el)) continue;
      const html = dataAttrsMedia(el, doc, pageUrl);
      if (html) put(el, html);
    }
    // 2) Video / audio / iframe / picture còn lại
    const ctx = { base, fallback: pageVideoSources(doc, base, opts), substack: isSubstack(doc, pageUrl) };
    try { ctx.origin = new URL(pageUrl).origin; } catch (e) { ctx.origin = ''; }
    for (const el of [...doc.querySelectorAll('picture, video, audio, iframe, embed[src]')]) {
      if (!el.isConnected || (el.tagName !== 'PICTURE' && el.closest('picture'))) continue;
      if (el.tagName === 'IFRAME' && /^https:\/\/rf-media\.invalid\//.test(el.getAttribute('src') || '')) continue; // ký hiệu giữ chỗ của bước 1
      if (isInAdOrChrome(el)) continue;
      ctx.root = el.tagName === 'VIDEO' || el.tagName === 'AUDIO' ? playerRoot(el) : el;
      const html = mediaHtml(el, pageUrl, ctx);
      if (!html) continue;
      put(ctx.root, html);
    }
    // 3) Phần điều khiển player còn sót lại (khi không tìm thấy video bên trong)
    doc.querySelectorAll(PLAYER_CHROME).forEach((x) => x.remove());
    return store;
  }

  const ANCHOR_SEL = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre, dt, dd';
  const normT = (t) => (t || '').replace(/\s+/g, ' ').trim();
  function lastBlockText(el, first) {
    if (el.matches && el.matches(ANCHOR_SEL)) { const t = normT(el.textContent); if (t.length >= 8) return t; }
    const list = el.querySelectorAll ? [...el.querySelectorAll(ANCHOR_SEL)] : [];
    if (!first) list.reverse();
    for (const b of list) { const t = normT(b.textContent); if (t.length >= 8) return t; }
    return '';
  }
  /* Chữ của khối văn bản gần nhất trước / sau vị trí media, để gắn lại media nếu Readability bỏ mất */
  function anchorsOf(node) {
    const find = (dir) => {
      for (let n = node; n && n.tagName !== 'BODY';) {
        const sib = dir < 0 ? n.previousElementSibling : n.nextElementSibling;
        if (sib) { n = sib; const t = lastBlockText(sib, dir > 0); if (t) return t; } else n = n.parentElement;
      }
      return '';
    };
    return { prev: find(-1), next: find(1) };
  }

  function reinsertLost(html, store, used, anchors) {
    const lost = store.map((x, i) => i).filter((i) => !used.has(i) && anchors[i] && (anchors[i].prev || anchors[i].next));
    if (!lost.length) return html;
    const d = new DOMParser().parseFromString('<!DOCTYPE html><body>' + html + '</body>', 'text/html');
    const blocks = [...d.body.querySelectorAll(ANCHOR_SEL)];
    const byText = new Map();
    for (const b of blocks) { const t = normT(b.textContent); if (t && !byText.has(t)) byText.set(t, b); }
    let changed = false;
    for (const i of lost) {
      const a = anchors[i];
      const fig = d.createElement('figure');
      fig.className = 'rf-media';
      fig.innerHTML = store[i];
      const after = a.prev && byText.get(a.prev), before = !after && a.next && byText.get(a.next);
      const ref = after || before;
      if (!ref) continue;
      const box = ref.closest('ul, ol, table, dl, pre') || ref;
      if (after) box.after(fig); else box.before(fig);
      used.add(i);
      changed = true;
    }
    return changed ? d.body.innerHTML : html;
  }

  function unstash(html, store, used) {
    if (!store.length) return html;
    return html.replace(/<iframe\b[^>]*?src="https:\/\/rf-media\.invalid\/(\d+)"[^>]*>\s*(<\/iframe>)?/g, (m, i) => {
      if (used) used.add(+i);
      return `<figure class="rf-media">${store[+i] || ''}</figure>`;
    });
  }

  /* Trang gần như chỉ có ảnh (truyện tranh, album): lấy khối chứa nhiều ảnh nhất. */
  function gallery(doc) {
    const imgs = [...doc.querySelectorAll('img[src]')].filter((img) => {
      const src = img.getAttribute('src') || '';
      if (!/^https?:/i.test(src) || JUNK_IMG.test(src) || isInAdOrChrome(img)) return false;
      const w = +img.getAttribute('width') || 0, h = +img.getAttribute('height') || 0;
      if ((w && w < 150) || (h && h < 150)) return false;
      return true;
    });
    if (imgs.length < 3) return null;
    const counts = new Map();
    for (const img of imgs) {
      let p = img.parentElement;
      for (let d = 0; p && d < 5; d++, p = p.parentElement) counts.set(p, (counts.get(p) || 0) + 1);
    }
    let best = null, bestN = 0;
    for (const [el, n] of counts) if (n > bestN || (n === bestN && best && best.contains(el))) { best = el; bestN = n; }
    if (!best || bestN < 3) return null;
    const html = imgs.filter((i) => best.contains(i)).map((i) => `<p><img src="${escAttr(i.getAttribute('src'))}" alt="${escAttr(i.getAttribute('alt') || '')}"></p>`).join('\n');
    return { html, count: bestN };
  }

  /* Trang không khai báo lang: đoán nhanh để chọn font và khoảng dòng phù hợp. */
  function guessLang(html) {
    const t = html.replace(/<[^>]+>/g, ' ').slice(0, 6000);
    const letters = (t.match(/\p{L}/gu) || []).length || 1;
    if ((t.match(/[\u3040-\u30ff]/g) || []).length / letters > 0.05) return 'ja';
    if ((t.match(/[\uac00-\ud7af]/g) || []).length / letters > 0.2) return 'ko';
    if ((t.match(/[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi) || []).length / letters > 0.02) return 'vi';
    return '';
  }

  function textLen(html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\[\[RFMEDIA_\d+\]\]/g, '').replace(/\s+/g, ' ').trim().length;
  }

  function hashText(html) {
    const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return h + ':' + t.length;
  }


  /* ---------- Dọn rác mà Readability để lại ---------- */

  // Liên kết "chia sẻ" của các mạng xã hội / email
  const SHARE_URL = new RegExp([
    '^mailto:[^@]*\\?', 'facebook\\.com\\/(sharer|share\\.php|dialog\\/(feed|share))', '(twitter|x)\\.com\\/(intent|share)',
    'b\\.hatena\\.ne\\.jp\\/(add|entry)', 'line\\.me\\/R\\/msg', 'social-plugins\\.line\\.me', 'timeline\\.line\\.me\\/social-plugin',
    'pinterest\\.[a-z.]+\\/pin\\/create', 'reddit\\.com\\/submit', 'linkedin\\.com\\/(shareArticle|sharing)', '(t|telegram)\\.me\\/share',
    'api\\.whatsapp\\.com\\/send', 'wa\\.me\\/\\?', 'getpocket\\.com\\/(save|edit)', 'zalo\\.me\\/share', 'tumblr\\.com\\/(share|widgets\\/share)',
    'threads\\.(net|com)\\/intent', 'bsky\\.app\\/intent', 'vk\\.com\\/share', 'weibo\\.com\\/share', 'note\\.com\\/intent',
    'misskey-hub\\.net\\/share', 'plus\\.google\\.com\\/share', 'mixi\\.jp\\/share', 'buffer\\.com\\/add', 'flipboard\\.com\\/bookmarklet'
  ].join('|'), 'i');
  // class/id của khối chia sẻ, theo dõi, in… (bắt cả kiểu viết liền như SnsShare)
  const SHARE_CLASS = /share|sns[-_A-Z]|\bsns\b|social-?(links?|buttons?|icons?|bar|share)|bookmark|follow-?(us|buttons?)|print-?(button|btn|link)|article-?tools|toolbar/i;
  // Nhãn quảng cáo đứng một mình
  const AD_LABEL = /^[\[［(（【〔]?\s*(pr|ad|ads|advertisement|advertising|sponsored|sponsor|広告|スポンサーリンク|スポンサー|プロモーション|quảng cáo|tài trợ|广告|赞助|광고)\s*[\]］)）】〕]?$/i;
  const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
  const DATE_CORE = '(\\d{4}\\s*[年\\/.-]\\s*\\d{1,2}\\s*[月\\/.-]\\s*\\d{1,2}\\s*日?' +
    '|\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}' +
    '|(' + MONTHS + ')[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4}' +
    '|\\d{1,2}\\s+(' + MONTHS + ')[a-z]*\\.?\\s+\\d{4}' +
    '|(ngày\\s*)?\\d{1,2}\\s*tháng\\s*\\d{1,2}\\s*(năm\\s*)?\\d{4})';
  const DATE_LINE = new RegExp('^([^\\d]{1,24}?[,，、:：]?\\s*)?(\\([^)]{1,4}\\)\\s*)?' + DATE_CORE +
    '(\\s*[（(][^)）]{1,3}[)）])?([\\sT,，]*\\d{1,2}\\s*[:時h]\\s*\\d{1,2}\\s*分?(:\\d{2})?(\\s*[ap]\\.?m\\.?)?)?' +
    '(\\s*\\(?(jst|utc|gmt|ict|est|edt|pst|pdt|cet|bst)\\s*[+\\-]?\\d{0,2}(:\\d{2})?\\)?)?(\\s*(更新|公開|配信|updated|published))?$', 'i');
  const EMPTY_TAGS = 'li, ul, ol, dl, dt, dd, p, div, span, section, figure, a, button, strong, em, b, i';

  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const hasMedia = (el) => el.tagName === 'IFRAME' || !!el.querySelector('img, picture, video, audio, iframe, svg');

  /* Leo lên từ liên kết chia sẻ tới khối lớn nhất chỉ chứa nút chia sẻ. */
  function shareContainer(a) {
    let el = a;
    for (let d = 0; d < 6 && el.parentElement; d++) {
      const p = el.parentElement;
      if (/^(BODY|MAIN|ARTICLE|HTML)$/.test(p.tagName)) break;
      let otherText = norm(p.textContent).length;
      for (const x of p.querySelectorAll('a[href]')) if (SHARE_URL.test(x.getAttribute('href') || '')) otherText -= norm(x.textContent).length;
      const otherLinks = [...p.querySelectorAll('a[href]')].filter((x) => !SHARE_URL.test(x.getAttribute('href') || '') && norm(x.textContent));
      if (otherText > 30 || otherLinks.length || p.querySelector('p, h1, h2, h3, img, video, iframe')) break;
      el = p;
    }
    return el;
  }

  function removeShares(root) {
    for (const a of [...root.querySelectorAll('a[href]')]) {
      if (!a.isConnected || !SHARE_URL.test(a.getAttribute('href') || '')) continue;
      shareContainer(a).remove();
    }
    for (const el of [...root.querySelectorAll('[class], [id]')]) {
      if (!el.isConnected || /^(BODY|MAIN|ARTICLE|HTML)$/.test(el.tagName)) continue;
      const c = (el.getAttribute('class') || '') + ' ' + (el.id || '');
      if (SHARE_CLASS.test(c) && norm(el.textContent).length < 200 && !el.querySelector('p, h1, h2, h3, img, video, iframe')) el.remove();
    }
  }

  /* Trước Readability: theo quy tắc người dùng + nút chia sẻ. */
  function preClean(doc, opts) {
    if (opts.removeSelector) {
      try { doc.querySelectorAll(opts.removeSelector).forEach((e) => e.remove()); } catch (e) { /* selector hỏng */ }
    }
    removeShares(doc.body || doc);
  }

  /* Sau Readability: nhãn quảng cáo, khối rỗng, dòng tên báo/ngày giờ ở đầu bài, chữ người dùng đã ẩn. */
  function postClean(html, meta, opts) {
    const d = new DOMParser().parseFromString('<!DOCTYPE html><body>' + html + '</body>', 'text/html');
    const body = d.body;
    removeShares(body);
    const hidden = new Set((opts.removeTexts || []).map(norm));
    const leaves = () => [...body.querySelectorAll('p, li, dt, dd, div, span, figcaption, h1, h2, h3, h4, h5, h6, time, small, a, button')]
      .filter((el) => !el.querySelector('p, li, div, h1, h2, h3, h4, h5, h6'));
    for (const el of leaves()) {
      if (!el.isConnected) continue;
      const t = norm(el.textContent);
      if ((AD_LABEL.test(t) || hidden.has(t)) && !hasMedia(el)) el.remove();
    }
    if (hidden.size) {
      for (const el of [...body.querySelectorAll('ul, ol, table, blockquote, section, figure, div')]) {
        if (el.isConnected && hidden.has(norm(el.textContent))) el.remove();
      }
    }
    // Dòng thông tin ở đầu bài: tên báo, tác giả, ngày giờ
    let date = '';
    const site = norm(meta.siteName), byline = norm(meta.byline);
    const squash = (t) => (t || '').replace(/[\s\u3000]+/g, '');
    const title = squash(meta.title);
    for (let guard = 0; guard < 8; guard++) {
      const first = leaves().find((el) => norm(el.textContent) || hasMedia(el));
      if (!first || hasMedia(first)) break;
      const t = norm(first.textContent);
      if (t.length > 80) break;
      const isSite = site && t.length <= 40 && (site.includes(t) || t.includes(site));
      const isByline = byline && (t === byline || byline.includes(t));
      const sq = squash(t);
      const isTitle = title && /^H[1-6]$/.test(first.tagName) && (sq === title || (title.includes(sq) && sq.length >= title.length * 0.6));
      const isDate = DATE_LINE.test(t) || (first.tagName === 'TIME') || (!!first.querySelector('time') && norm(first.querySelector('time').textContent) === t);
      if (!isSite && !isByline && !isDate && !isTitle) break;
      if (isDate && !date) date = t;
      first.remove();
    }
    // Khối rỗng (li trống, nút không chữ…) sau khi dọn
    for (let pass = 0; pass < 3; pass++) {
      for (const el of [...body.querySelectorAll(EMPTY_TAGS)].reverse()) {
        if (el.isConnected && !norm(el.textContent) && !hasMedia(el) && !el.querySelector('br + br')) el.remove();
      }
    }
    return { html: body.innerHTML, date };
  }

  /* Bỏ phần "：Tên báo" / " | Tên báo" ở cuối tiêu đề. */
  function cleanTitle(title, siteName) {
    let t = norm(title);
    const site = norm(siteName);
    const seps = '[|｜:：\\-–—・/]';
    if (site) {
      const esc = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      t = t.replace(new RegExp('\\s*' + seps + '\\s*' + esc + '\\s*$'), '').replace(new RegExp('^' + esc + '\\s*' + seps + '\\s*'), '');
    }
    return t;
  }

  /**
   * @returns {null | {title, byline, siteName, html, textLength, hash, lang, dir}}
   */
  function extract(doc, pageUrl, opts = {}) {
    const minText = opts.minTextLength || 200;
    prepare(doc, pageUrl);
    let lead = null;
    for (const fn of LEAD_ADAPTERS) { try { lead = fn(doc, pageUrl); } catch (e) { lead = null; } if (lead) break; }
    preClean(doc, opts);
    const store = opts.keepMedia !== false ? stashMedia(doc, pageUrl, opts) : [];
    const published = (doc.querySelector('meta[property="article:published_time"], meta[itemprop="datePublished"], meta[name="pubdate"]') || {}).content || '';
    const docTitle = (doc.querySelector('meta[property="og:title"]') || {}).content || doc.title || '';
    const siteName = (doc.querySelector('meta[property="og:site_name"]') || {}).content || '';
    const lang = doc.documentElement.getAttribute('lang') || '';

    let html = null, title = docTitle, byline = '', dir = null;

    const contentSelector = opts.contentSelector || (lead && lead.contentSelector);
    if (contentSelector) {
      let el = null;
      try { el = doc.querySelector(contentSelector); } catch (e) { /* selector hỏng */ }
      if (el) html = el.innerHTML;
    }

    if (html === null) {
      let article = null;
      try {
        article = new Readability(doc.cloneNode(true), {
          charThreshold: 300,
          keepClasses: false,
          allowedVideoRegex: EMBED_RE
        }).parse();
      } catch (e) { article = null; }
      const gal = gallery(doc);
      if (article && article.content) {
        const artImgs = (article.content.match(/<img\b/g) || []).length;
        if (gal && textLen(article.content) < minText && gal.count > artImgs) html = gal.html;
        else {
          html = article.content;
          title = article.title || docTitle;
          byline = article.byline || '';
          dir = article.dir;
        }
      } else if (gal) html = gal.html;
    }

    if (html === null) return null;
    title = cleanTitle(title, siteName);
    const cleaned = postClean(html, { siteName, byline, title }, opts);
    const used = new Set();
    html = unstash(cleaned.html, store, used);
    // Media mà Readability bỏ mất cùng khung chứa: gắn lại cạnh đoạn văn đứng trước/sau nó
    html = reinsertLost(html, store, used, store.anchors || []);
    // Bài không còn video nào: lấy video chính của trang
    const noMedia = () => !/<(video|audio)\b|class="rf-embed"|class="rf-media-missing"/.test(html);
    if (noMedia()) {
      const bigIdx = (opts.liveBig || []).map((n) => store.findIndex((x, k) => !used.has(k) && x.includes(`data-rf-live="${n}"`))).filter((i) => i >= 0);
      const playable = bigIdx.find((i) => !store[i].includes('rf-media-missing'));
      const embed = playerMetaEmbed(doc, pageUrl);
      // 1) video lớn trên trang đã có nguồn phát; 2) trình phát nhúng khai báo trong og:video / twitter:player;
      // 3) video lớn chưa có nguồn (sẽ mượn player gốc)
      const pick = playable != null ? store[playable] : embed || (bigIdx.length ? store[bigIdx[0]] : null);
      if (pick) html = `<figure class="rf-media">${pick}</figure>` + html;
    }
    // Video/podcast chính của bài nằm ngoài thân bài: đặt lên đầu nếu chưa có
    if (lead && lead.byline && !byline) byline = lead.byline;
    if (lead && lead.html && !html.includes(lead.key)) html = `<figure class="rf-media">${lead.html}</figure>` + html;
    if (lead && lead.transcript) html += `<details class="rf-transcript"><summary>${escAttr(rfT('transcript'))}</summary>${lead.transcript}</details>`;
    const len = textLen(html);
    const mediaCount = (html.match(/<(img|video|audio|iframe)\b/g) || []).length;
    return {
      title: title.trim(), byline, siteName, html, textLength: len, mediaCount, hash: hashText(html),
      lang: lang || guessLang(html), dir, date: cleaned.date || formatDate(published || (lead && lead.published), lang)
    };
  }

  function formatDate(iso, lang) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    try { return d.toLocaleString(lang || undefined, { dateStyle: 'long', timeStyle: 'short' }); } catch (e) { return d.toLocaleString(); }
  }

  return { extract, prepare, postClean, cleanTitle, SHARE_URL };
})();
