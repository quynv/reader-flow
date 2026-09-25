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

test('DPlayer keeps video without controller chrome', () => {
  const chrome = 'Controller junk Current Time Duration Quality 720p 480p Playback speed Danmaku opacity '.repeat(5);
  const html = run(`<div class="dplayer">
    <div class="dplayer-video-wrap"><video class="dplayer-video-current" src="https://cdn.example.com/movie.mp4"></video></div>
    <div class="dplayer-danmaku">${chrome}</div>
    <div class="dplayer-controller">${chrome}</div>
    <div class="dplayer-menu">${chrome}</div>
    <div class="dplayer-info-panel">${chrome}</div>
  </div>`);
  assert.match(html, /<video\b[^>]*>[\s\S]*movie\.mp4[\s\S]*<\/video>/, 'DPlayer video must be preserved');
  assert.doesNotMatch(html, /Controller junk|Current Time|Quality 720p|Danmaku opacity/, 'DPlayer controls must not leak into the article');
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
