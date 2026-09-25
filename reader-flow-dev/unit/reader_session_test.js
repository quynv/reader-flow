const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body><div id="page-player"><video id="original"></video></div><div class="dplayer"><video id="dplayer-video"></video></div></body></html>', {
  url: 'https://example.com/article'
});
const w = dom.window;
Object.assign(global, {
  window: w, document: w.document, location: w.location, MutationObserver: w.MutationObserver,
  rfT: (key) => key,
  chrome: {
    runtime: { onMessage: { addListener() {}, removeListener() {} } },
    storage: { onChanged: { addListener() {}, removeListener() {} } }
  }
});
global.__rfNoAutoOpen = true;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', '..', 'reader-flow', 'content.js'), 'utf8'));

async function main() {
  const app = global.__rf;
  const host = document.createElement('rf-reader-host');
  const root = document.createElement('div');
  host.append(root);
  document.body.append(host);
  const scroll = document.createElement('main');
  scroll.scrollTop = 180;
  const article = document.createElement('article');
  article.innerHTML = '<p>Parsed paragraph <span class="rf-tr">Translated paragraph</span></p><div id="slot"></div>';
  root.append(scroll);
  scroll.append(article);
  app.hostEl = host;
  app.el = { root, scroll, panel: { hidden: true } };
  app.opened = true;
  app.s = {};
  app.sessionUrl = location.href;
  app.prevOverflow = '';
  document.documentElement.style.overflow = 'hidden';
  const translation = article.querySelector('.rf-tr');
  const translator = {
    active: true,
    stop() { this.active = false; },
    start() { this.active = true; },
    destroy() { this.destroyed = true; }
  };
  app.translator = translator;
  app.speaker = { stop() {}, destroy() {} };
  app.liveVideos = [document.getElementById('original'), document.getElementById('dplayer-video')];
  Object.defineProperty(document, 'pictureInPictureEnabled', { value: true });
  const dplayerSlot = document.createElement('div');
  dplayerSlot.className = 'rf-media-missing';
  dplayerSlot.setAttribute('data-rf-live', '1');
  dplayerSlot.setAttribute('data-rf-pip', '1');
  article.append(dplayerSlot);
  app.setupLiveVideos(article);
  assert.strictEqual(document.querySelector('.dplayer #dplayer-video'), app.liveVideos[1], 'DPlayer must stay on its original page');
  const pipButton = article.querySelector('.rf-media-missing button');
  assert.ok(pipButton, 'Reader must offer PiP for DPlayer');
  let pipRequests = 0;
  app.liveVideos[1].requestPictureInPicture = async () => { pipRequests++; };
  app.liveVideos[1].play = async () => {};
  pipButton.click();
  await Promise.resolve();
  assert.strictEqual(pipRequests, 1, 'PiP button must open the original DPlayer video');
  app.borrow(document.getElementById('slot'), '0');

  // Hủy hộp hỏi phải giữ Reader Mode và bản dịch.
  await app.toggle();
  assert.ok(root.querySelector('[role="dialog"]'), 'Close must offer choices');
  app.onKey(new w.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  assert.ok(!root.querySelector('[role="dialog"]'), 'Escape must cancel an open choice');
  app.requestClose();
  root.querySelector('.rf-close-cancel').click();
  assert.ok(host.isConnected);
  assert.strictEqual(article.querySelector('.rf-tr'), translation);

  // Thoát tạm thời trả player về trang gốc nhưng giữ đúng DOM bài và vị trí đọc.
  app.requestClose();
  root.querySelector('.rf-close-temporary').click();
  assert.strictEqual(host.style.display, 'none');
  assert.strictEqual(document.querySelector('#page-player #original'), app.liveVideos[0]);
  assert.strictEqual(article.querySelector('.rf-tr'), translation);
  assert.strictEqual(scroll.scrollTop, 180);
  assert.strictEqual(translator.active, false);

  // Mở lại dùng lại phiên cũ và mượn lại player.
  await app.toggle();
  assert.notStrictEqual(host.style.display, 'none');
  assert.strictEqual(article.querySelector('.rf-tr'), translation);
  assert.strictEqual(scroll.scrollTop, 180);
  assert.strictEqual(translator.active, true);
  assert.ok(article.querySelector('.rf-borrowed #original'));

  // Thoát hẳn hủy phiên; mở lần sau phải tạo phiên mới.
  app.requestClose();
  root.querySelector('.rf-close-permanent').click();
  assert.ok(!host.isConnected);
  assert.strictEqual(translator.destroyed, true);
  assert.strictEqual(app.hostEl, null);
  assert.strictEqual(document.querySelector('#page-player #original'), app.liveVideos[0]);
  app.destroy();
  console.log('PASS temporary close resumes parsed and translated session; permanent close destroys it');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
