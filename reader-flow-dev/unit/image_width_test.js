const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const base = path.join(__dirname, '..', '..', 'reader-flow');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://example.com/article' });
const w = dom.window;
const saved = [];
Object.assign(global, {
  window: w, document: w.document, location: w.location, MutationObserver: w.MutationObserver,
  rfT: (key) => key, rfI18n: { lang: 'en' }, RFFonts: { ensure() {} },
  RF_LOCALE_NAMES: { en: 'English' }, RF_LOCALE_TARGET: { en: 'English' },
  chrome: {
    runtime: { onMessage: { addListener() {}, removeListener() {} } },
    storage: {
      local: { async get() { return {}; }, async set(patch) { saved.push(patch); } },
      onChanged: { addListener() {}, removeListener() {} }
    }
  }
});
vm.runInThisContext(fs.readFileSync(path.join(base, 'lib', 'settings.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(base, 'lib', 'reader-css.js'), 'utf8'));
global.__rfNoAutoOpen = true;
vm.runInThisContext(fs.readFileSync(path.join(base, 'content.js'), 'utf8'));

async function main() {
  const app = global.__rf;
  const stylesheet = document.createElement('style');
  stylesheet.textContent = RF_CSS;
  document.head.append(stylesheet);
  const root = document.createElement('div');
  root.innerHTML = '<div class="rf-content"><article class="rf-article">' +
    '<figure><img id="photo" src="photo.jpg" width="320" height="180"></figure>' +
    '<p><img id="paragraph-photo" src="story.jpg" width="320" height="180"></p>' +
    '<p>Inline <img id="icon" src="icon.png" width="16" height="16"> symbol</p>' +
    '</article></div>';
  document.body.append(root);
  app.s = { ...RF_DEFAULTS };
  app.el = { root, panel: { hidden: true } };
  const photo = document.getElementById('photo');
  const paragraphPhoto = document.getElementById('paragraph-photo');
  const icon = document.getElementById('icon');
  const style = (el) => w.getComputedStyle(el);

  assert.strictEqual(app.s.imageFullWidth, false, 'existing image sizing must remain the default');
  app.applyLook();
  assert.notStrictEqual(style(photo).width, '100%');
  const panel = app.buildPanel();
  root.append(panel);
  const control = panel.querySelector('input[type="checkbox"][data-key="imageFullWidth"]');
  assert.ok(control, 'quick settings must expose image width');
  assert.strictEqual(control.checked, false);
  control.checked = true;
  control.dispatchEvent(new w.Event('change', { bubbles: true }));
  await Promise.resolve();
  assert.strictEqual(app.s.imageFullWidth, true);
  assert.deepStrictEqual(saved.at(-1), { imageFullWidth: true });
  assert.strictEqual(style(photo).width, '100%');
  assert.strictEqual(style(photo).height, 'auto');
  app.markBlockImages(root);
  assert.strictEqual(style(paragraphPhoto).width, '100%');
  assert.notStrictEqual(style(icon).width, '100%', 'inline icons must not be enlarged');
  app.s.lineWidth = 900;
  app.applyLook();
  assert.strictEqual(root.style.getPropertyValue('--rf-width'), '900px');
  assert.strictEqual(style(photo).width, '100%');

  const options = new JSDOM(fs.readFileSync(path.join(base, 'options.html'), 'utf8')).window.document;
  assert.ok(options.querySelector('input[type="checkbox"][data-key="imageFullWidth"]'), 'Options must expose the same setting');
  app.destroy();
  console.log('PASS image width follows reading column when enabled, preserving inline icons and default sizing');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
