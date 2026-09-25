const { JSDOM } = require('jsdom'); const fs = require('fs');
const P = (v) => Array.from({length:5},(_,i)=>`<p>Đoạn ${i+1}. Danh sách đề cử Top 100 Gương mặt đẹp nhất thế giới do TC Candler bình chọn năm 2026 vừa chính thức công bố tên JIWOO. JIWOO gây ấn tượng mạnh mẽ bởi đường nét gương mặt góc cạnh.</p>`).join(v);
const vjs = (src) => `<div class="video-js vjs-default-skin" id="vjs_1"><video class="vjs-tech" src="${src}" preload="auto"></video>
 <div class="vjs-poster" style="background-image:url(x.jpg)"></div><button class="vjs-big-play-button"><span class="vjs-control-text">Play Video</span></button>
 <div class="vjs-control-bar"><div class="vjs-current-time"><span class="vjs-control-text">Current Time</span>0:00</div><span>/</span>
 <div class="vjs-duration"><span class="vjs-control-text">Duration</span>3:12</div>
 <div class="vjs-menu-button"><span>auto</span><div class="vjs-menu"><ul class="vjs-menu-content"><li>720p</li><li>480p</li><li>360p</li><li>auto</li></ul></div></div></div></div>`;
const cases = {
  'A fetched kenh14 (no player yet)': `<div class="VCSortableInPreviewMode" type="VideoStream" data-vid="kenh14cdn.com/203336854389633024/2026/9/24/clip.mp4" data-thumb="https://kenh14cdn.com/thumb/clip.jpg"></div>`,
  'B live kenh14 (video.js, blob)': `<div class="VCSortableInPreviewMode" type="VideoStream" data-vid="kenh14cdn.com/203336854389633024/2026/9/24/clip.mp4" data-thumb="https://kenh14cdn.com/thumb/clip.jpg">${vjs('blob:https://kenh14.vn/1234-5678')}</div>`,
  'C blob + JSON-LD m3u8': vjs('blob:https://x.vn/abcd'),
  'D blob, nothing known': vjs('blob:https://x.vn/zzz'),
};
const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","video":{"@type":"VideoObject","contentUrl":"https://vod.x.vn/hls/abc/master.m3u8"}}</script>`;
for (const [name, media] of Object.entries(cases)) {
  const html = `<html lang="vi"><head><title>T</title>${name.startsWith('C') ? ld : ''}</head><body><article><h1>T</h1>${P('')}${media}${P('')}</article></body></html>`;
  const dom = new JSDOM(html, { url: 'https://kenh14.vn/a-215260924163421255.chn' });
  global.window = dom.window; global.document = dom.window.document; global.DOMParser = dom.window.DOMParser; global.rfT = (k) => k;
  eval(fs.readFileSync(require('path').join(__dirname, '..', '..', 'reader-flow', 'lib', 'Readability.js'), 'utf8') + '\nglobal.Readability = Readability;');
  eval(fs.readFileSync(require('path').join(__dirname, '..', '..', 'reader-flow', 'lib', 'extract.js'), 'utf8'));
  const r = RFExtract.extract(dom.window.document, 'https://kenh14.vn/a-215260924163421255.chn', { keepMedia: true });
  const out = r.html;
  const vid = (out.match(/<video[\s\S]*?<\/video>/) || [''])[0].replace(/\s+/g, ' ');
  const miss = /rf-media-missing/.test(out);
  const junk = /Current Time|Duration|720p|480p|Play Video/.test(out.replace(/<[^>]+>/g, ' '));
  console.log(name.padEnd(34), '| video:', vid || '-', '| missing-notice:', miss, '| control text left:', junk);
}
