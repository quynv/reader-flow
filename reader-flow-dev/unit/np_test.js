const { JSDOM } = require('jsdom');
const fs = require('fs');
const w = new JSDOM('').window;
global.CSS = { escape: (s) => s.replace(/[^\w-]/g, (c) => '\\' + c) };
global.globalThis.RFNext = undefined;
eval(fs.readFileSync(require('path').join(__dirname, '..', '..', 'reader-flow', 'lib', 'nextpage.js'), 'utf8'));
const cases = [
  ['wp older', 'https://blog.example.com/', `<nav class="navigation posts-navigation"><div class="nav-previous"><a href="https://blog.example.com/page/2/">Older posts</a></div></nav><a href="/about">About</a>`, 'https://blog.example.com/page/2/'],
  ['wp page numbers p2', 'https://blog.example.com/page/2/', `<div class="nav-links"><a class="prev page-numbers" href="/">« Previous</a><a class="page-numbers" href="/">1</a><span aria-current="page" class="page-numbers current">2</span><a class="page-numbers" href="/page/3/">3</a><a class="page-numbers" href="/page/9/">9</a><a class="next page-numbers" href="/page/3/">Next »</a></div>`, 'https://blog.example.com/page/3/'],
  ['query page, number only', 'https://s.jp/list?cat=5&page=3', `<div class="pager"><a href="?cat=5&page=2">2</a><b class="current">3</b><a href="?cat=5&page=4">4</a><a href="?cat=5&page=5">5</a></div>`, 'https://s.jp/list?cat=5&page=4'],
  ['novel chapter vi', 'https://truyen.vn/truyen-a/chuong-12/', `<a href="/truyen-a/chuong-11/" class="btn">Chương trước</a><a href="/truyen-a/">Mục lục</a><a href="/truyen-a/chuong-13/" class="btn">Chương sau</a>`, 'https://truyen.vn/truyen-a/chuong-13/'],
  ['japanese', 'https://ncode.x.jp/n1234/5/', `<div class="novel_bn"><a href="/n1234/4/">&lt;&lt; 前へ</a><a href="/n1234/6/">次へ &gt;&gt;</a></div>`, 'https://ncode.x.jp/n1234/6/'],
  ['chinese', 'https://b.cn/book/1/2.html', `<a href="/book/1/1.html">上一章</a><a href="/book/1/">目录</a><a href="/book/1/3.html">下一章</a>`, 'https://b.cn/book/1/3.html'],
  ['rel next head', 'https://news.com/a/story', `<head><link rel="next" href="/a/story?p=2"></head><body><p>x</p></body>`, 'https://news.com/a/story?p=2'],
  ['arrow only in pager', 'https://f.com/t/123', `<div class="pagination"><a href="/t/123?page=2">›</a><a href="/t/123?page=9">»</a></div>`, 'https://f.com/t/123?page=2'],
  ['no pagination (should be null)', 'https://f.com/article-99', `<header><a href="/next-gen">Next generation</a></header><a href="/article-100">Another article</a><a href="/login">Login</a>`, null],
  ['newer vs older', 'https://b.com/page/3', `<a href="/page/2">Newer posts</a><a href="/page/4">Older posts</a>`, 'https://b.com/page/4'],
  ['other domain rejected', 'https://a.com/x?page=1', `<a href="https://evil.com/x?page=2">Next</a>`, null],
  ['rule', 'https://r.com/c/1', `<div class="btns"><a class="b" href="/c/0">Back</a><a class="b" href="/c/2">Continue ▸</a></div>`, 'https://r.com/c/2', {nextSelector: 'div.btns > a.b', nextText: 'Continue ▸'}],
];
let pass = 0;
for (const [name, url, html, want, rule] of cases) {
  const doc = new JSDOM(html, { url }).window.document;
  const r = RFNext.find(doc, url, { rule });
  const got = r ? r.url : null;
  const ok = got === want; pass += ok;
  console.log(ok ? 'PASS' : 'FAIL', name, '->', got, r ? `(${r.score}: ${r.reason})` : '');
}
console.log(pass + '/' + cases.length);
