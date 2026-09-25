const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..', 'reader-flow', 'lib');
const readability = fs.readFileSync(path.join(root, 'Readability.js'), 'utf8');
const extract = fs.readFileSync(path.join(root, 'extract.js'), 'utf8');
const paragraphs = Array.from({ length: 6 }, (_, i) =>
  `<p>Paragraph ${i + 1}. This article contains enough descriptive text for Readability to keep the main content and embedded media during extraction.</p>`
).join('');

function run(body, url = 'https://example.com/article') {
  const dom = new JSDOM(`<html><head><title>Media article</title></head><body><article>${paragraphs}${body}${paragraphs}</article></body></html>`, { url });
  global.window = dom.window;
  global.document = dom.window.document;
  global.DOMParser = dom.window.DOMParser;
  global.Node = dom.window.Node;
  global.rfT = (key) => key;
  eval(readability + '\nglobal.Readability = Readability;');
  eval(extract);
  return RFExtract.extract(dom.window.document, url, { keepMedia: true }).html;
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (error) {
    failures++;
    console.error('FAIL', name, '-', error.message);
  }
}

test('DPlayer offers the live player for PiP without cloning video or controller chrome', () => {
  const chrome = 'Controller junk Current Time Duration Quality 720p 480p Playback speed Danmaku opacity '.repeat(5);
  const html = run(`<div class="dplayer">
    <div class="dplayer-video-wrap"><video class="dplayer-video-current" data-rf-vid="0" src="https://cdn.example.com/movie.mp4"></video></div>
    <div class="dplayer-danmaku">${chrome}</div>
    <div class="dplayer-controller">${chrome}</div>
    <div class="dplayer-menu">${chrome}</div>
    <div class="dplayer-info-panel">${chrome}</div>
  </div>`);
  const out = new JSDOM(`<body>${html}</body>`).window.document;
  const slot = out.querySelector('.rf-media-missing[data-rf-live="0"][data-rf-pip="1"]');
  assert.ok(slot, 'DPlayer must point to the live video for PiP');
  assert.ok(!out.querySelector('video'), 'DPlayer video must not be cloned into the reader');
  assert.doesNotMatch(html, /Controller junk|Current Time|Quality 720p|Danmaku opacity/, 'DPlayer controls must not leak into the article');
});

test('DPlayer data-src shortcut also keeps its live video for PiP', () => {
  const html = run(`<div class="dplayer" data-src="https://cdn.example.com/movie.mp4">
    <div class="dplayer-video-wrap"><video data-rf-vid="0" src="blob:https://example.com/stream"></video></div>
    <div class="dplayer-controller">Current Time Duration</div>
  </div>`);
  const out = new JSDOM(`<body>${html}</body>`).window.document;
  assert.ok(out.querySelector('.rf-media-missing[data-rf-live="0"][data-rf-pip="1"]'));
  assert.ok(!out.querySelector('video'));
});

test('DPlayer with a script-managed video still offers PiP', () => {
  const html = run(`<div class="dplayer"><div class="dplayer-video-wrap"><video data-rf-vid="0"></video></div>
    <div class="dplayer-controller">Current Time Duration</div></div>`);
  const out = new JSDOM(`<body>${html}</body>`).window.document;
  assert.ok(out.querySelector('.rf-media-missing[data-rf-live="0"][data-rf-pip="1"]'));
});

test('DPlayer on a fetched page links to the original when no live video exists', () => {
  const html = run(`<div class="dplayer"><div class="dplayer-video-wrap"><video></video></div>
    <div class="dplayer-controller">Current Time Duration</div></div>`);
  const out = new JSDOM(`<body>${html}</body>`).window.document;
  assert.ok(out.querySelector('.rf-media-missing a[href="https://example.com/article"]'));
  assert.ok(!out.querySelector('video'));
});

test('Elementor gallery preserves background images', () => {
  const items = [1, 2, 3].map((n) => `<a class="e-gallery-item elementor-gallery-item" href="/uploads/full-${n}.jpg">
    <div class="e-gallery-image elementor-gallery-item__image" data-thumbnail="/uploads/thumb-${n}.jpg"
      data-width="1200" data-height="800" aria-label="Gallery image ${n}"
      style="background-image: url(&quot;/uploads/thumb-${n}.jpg&quot;)"></div>
  </a>`).join('');
  const html = run(`<div class="elementor-gallery__container e-gallery-container">${items}</div>`);
  const out = new JSDOM(`<body>${html}</body>`).window.document;
  const sources = [...out.querySelectorAll('img')].map((img) => img.getAttribute('src'));
  assert.deepStrictEqual(sources, [
    'https://example.com/uploads/full-1.jpg',
    'https://example.com/uploads/full-2.jpg',
    'https://example.com/uploads/full-3.jpg'
  ], 'Elementor background-image gallery must become real images');
});

if (failures) process.exitCode = 1;
