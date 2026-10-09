const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const base = path.join(__dirname, '..', '..', 'reader-flow');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://news.example/story/1' });
global.document = dom.window.document;
const exporterPath = path.join(base, 'lib', 'export-markdown.js');
if (fs.existsSync(exporterPath)) vm.runInThisContext(fs.readFileSync(exporterPath, 'utf8'));

const section = document.createElement('section');
section.innerHTML = '<header class="rf-page-head"><h1>Story title</h1><p class="rf-byline">Author · Today</p></header>' +
  '<div class="rf-article"><h2>Introduction</h2>' +
  '<p>Read <a href="https://news.example/more">more</a> about this.</p>' +
  '<div>Inline <strong>bold</strong> ending.</div>' +
  '<p class="rf-has-tr"><span class="rf-orig">Original <em>sentence</em>.</span><span class="rf-tr">Translated sentence.</span></p>' +
  '<p class="rf-has-tr"><span class="rf-orig">Still translating.</span><span class="rf-tr rf-tr-pending">Partial output</span></p>' +
  '<ul><li>First</li><li>Second</li><li class="rf-has-tr"><span class="rf-orig">Source item</span><span class="rf-tr">Translated item</span></li></ul>' +
  '<table><tr><th>Term</th><th>Meaning</th></tr><tr><td class="rf-has-tr"><span class="rf-orig">Source term</span><span class="rf-tr">Translated term</span></td><td>Definition</td></tr></table>' +
  '<pre><code>alpha\n\n\nbeta</code></pre>' +
  '<figure><img src="/photo.jpg" alt="A photo"><figcaption>Photo caption</figcaption></figure>' +
  '<video poster="/poster.jpg"><source src="https://cdn.example/clip.mp4"></video>' +
  '<video src="blob:https://news.example/live"><source src="https://cdn.example/fallback.mp4"></video>' +
  '<div class="rf-media-missing" data-rf-pip="1"><button>PiP</button><a href="https://news.example/story/1">Open on page</a></div>' +
  '<details class="rf-transcript"><summary>Transcript</summary><p>Spoken words.</p></details>' +
  '</div>';
section.querySelectorAll('.rf-has-tr')[0].__rfState = 'done';
section.querySelectorAll('.rf-has-tr')[1].__rfState = 'pending';
section.querySelectorAll('.rf-has-tr')[2].__rfState = 'done';
section.querySelectorAll('.rf-has-tr')[3].__rfState = 'done';
const second = document.createElement('section');
second.innerHTML = '<div class="rf-seam">Reader controls</div><div class="rf-article">' +
  '<p>Page two.</p><img src="blob:https://news.example/dead" alt="Temporary image">' +
  '<video src="blob:https://news.example/dead"></video></div>';
const pages = [
  { url: 'https://news.example/story/1', title: 'Story title', section },
  { url: 'https://news.example/story/2', title: 'Story title', section: second }
];
const labels = { source: 'Source', page: (n) => `Page ${n}`, video: 'Watch video', image: 'Image', transcript: 'Transcript' };

const bilingual = RFMarkdown.render(pages, 'bilingual', labels);
assert.match(bilingual, /^# Story title\n\nSource: https:\/\/news\.example\/story\/1/);
assert.match(bilingual, /## Introduction/);
assert.match(bilingual, /\[more\]\(https:\/\/news\.example\/more\)/);
assert.match(bilingual, /Inline \*\*bold\*\* ending\./, 'inline markup in a generic div stays in one paragraph');
assert.match(bilingual, /Original \*sentence\*\./);
assert.match(bilingual, /> Translated sentence\./);
assert.match(bilingual, /Still translating\./);
assert.ok(!bilingual.includes('Partial output'), 'unfinished translation must not leak into export');
assert.match(bilingual, /- First\n- Second/);
assert.match(bilingual, /- Source item\n\n  > Translated item/, 'bilingual list item includes the finished translation');
assert.match(bilingual, /\| Source term.*Translated term \| Definition \|/, 'bilingual table cells retain both visible versions');
assert.match(bilingual, /```\nalpha\n\n\nbeta\n```/, 'fenced code must preserve internal blank lines');
assert.match(bilingual, /!\[A photo\]\(https:\/\/news\.example\/photo\.jpg\)/);
assert.match(bilingual, /Photo caption/);
assert.match(bilingual, /!\[Video poster\]\(https:\/\/news\.example\/poster\.jpg\)/);
assert.match(bilingual, /\[Watch video\]\(https:\/\/cdn\.example\/clip\.mp4\)/);
assert.match(bilingual, /\[Watch video\]\(https:\/\/cdn\.example\/fallback\.mp4\)/, 'prefer a portable source over a blob player URL');
assert.ok(!bilingual.includes('story/null'), 'missing poster or source must never become a literal null URL');
assert.match(bilingual, /## Page 2\n\nSource: https:\/\/news\.example\/story\/2/);
assert.match(bilingual, /Page two\./);
assert.match(bilingual, /\[Image: Temporary image\]\(https:\/\/news\.example\/story\/2\)/);
assert.ok(!bilingual.includes('blob:'), 'temporary media URLs must not be exported');
assert.ok(!bilingual.includes('Reader controls') && !bilingual.includes('PiP'), 'reader controls must not leak into export');
assert.match(bilingual, /Spoken words\./);

const replaced = RFMarkdown.render(pages.slice(0, 1), 'replace', labels);
assert.ok(replaced.includes('Translated sentence.') && !replaced.includes('Original *sentence*.'), 'replace mode uses completed translations');
assert.ok(replaced.includes('| Translated term | Definition |') && !replaced.includes('| Source termTranslated term |'), 'table cells follow replace mode');
assert.ok(replaced.includes('- Translated item') && !replaced.includes('- Source itemTranslated item'), 'list items follow replace mode');
assert.ok(replaced.includes('Still translating.'), 'replace mode falls back to original for unfinished translation');
const sourceOnly = RFMarkdown.render(pages.slice(0, 1), 'off', labels);
assert.ok(sourceOnly.includes('Original *sentence*.') && !sourceOnly.includes('Translated sentence.'), 'source mode omits translations');
assert.strictEqual(RFMarkdown.filename('A/B: Story?'), 'A-B- Story.md');

async function testDownload() {
  Object.assign(global, {
    window: dom.window, location: dom.window.location, MutationObserver: dom.window.MutationObserver,
    rfT: (key, n) => key === 'mdExported' ? `Exported ${n} loaded page` : key,
    chrome: {
      runtime: { onMessage: { addListener() {}, removeListener() {} } },
      storage: { onChanged: { addListener() {}, removeListener() {} } }
    }
  });
  global.__rfNoAutoOpen = true;
  vm.runInThisContext(fs.readFileSync(path.join(base, 'content.js'), 'utf8'));
  const app = global.__rf;
  app.s = { trDisplay: 'bilingual' };
  app.pages = pages.slice(0, 1);
  app.el = {};
  const bar = app.buildBar();
  document.body.append(bar);
  app.el.bar = bar;
  const exportButton = bar.querySelector('.rf-export');
  assert.ok(exportButton, 'Reader toolbar must expose Markdown export');
  let blob, downloaded, revoked;
  const timers = [];
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const click = dom.window.HTMLAnchorElement.prototype.click;
  const timeout = global.setTimeout;
  URL.createObjectURL = (value) => { blob = value; return 'blob:reader-export'; };
  URL.revokeObjectURL = (url) => { revoked = url; };
  dom.window.HTMLAnchorElement.prototype.click = function () { downloaded = { name: this.download, url: this.href }; };
  global.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  try {
    exportButton.click();
    assert.deepStrictEqual(downloaded, { name: 'Story title.md', url: 'blob:reader-export' });
    assert.strictEqual(blob.type, 'text/markdown;charset=utf-8');
    assert.match(await blob.text(), /Translated sentence\./);
    assert.match(exportButton.textContent, /1 loaded page/);
    timers.forEach((fn) => fn());
    assert.strictEqual(revoked, 'blob:reader-export');
  } finally {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    dom.window.HTMLAnchorElement.prototype.click = click;
    global.setTimeout = timeout;
    app.destroy();
  }
  console.log('PASS Markdown export preserves displayed text, loaded pages, and portable media links');
}

testDownload().catch((error) => { console.error(error); process.exitCode = 1; });
