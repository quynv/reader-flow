const { JSDOM } = require('jsdom'); const fs = require('fs');
global.CSS = { escape: (s) => s };
eval(fs.readFileSync(require('path').join(__dirname, '..', '..', 'reader-flow', 'lib', 'nextpage.js'), 'utf8'));
const B = 'https://medium.com/omarelgabrys-blog/';
const P = ['database-introduction-part-1-4844fada1fb0','database-fundamentals-part-2-b841032243ac','database-design-process-part-3-7b5fafc78774','database-normalization-part-7-ef7225150c7f','database-structured-query-language-part-8-230a1808ec96'];
const toc = `<blockquote>This is a long series of tutorials. We are going cover:</blockquote><ul>
<li><a href="${B+P[0]}">An introduction to databases (why, what, and DBMS)</a>.</li>
<li><a href="${B+P[1]}">The fundamentals of the databases</a>.</li>
<li><a href="${B+P[2]}">The database design process</a>.</li>
<li><a href="${B+P[3]}">Normalization</a>.</li>
<li><a href="${B+P[4]}">The structured query language (SQL)</a>.</li></ul>`;
const page = (i, title, prose) => `<html><head><title>${title} | by Omar Elgabry | Medium</title><meta property="og:title" content="${title}"></head><body>
<nav><a href="https://medium.com/?source=x">Medium</a><a href="${B}?source=nav">Blog</a><a href="${B+P[i]}?source=nav">This post</a><a href="https://medium.com/m/signin">Sign in</a></nav>
<article><h1>${title}</h1><ol><li><a href="https://medium.com/?source=post#f3f6">Why Do We Need A Database?</a></li><li><a href="https://medium.com/?source=post#8c0d">Size</a></li><li><a href="https://medium.com/?source=post#7400">Accuracy</a></li></ol>
${toc}<p>Lorem ipsum body text.</p><h2>Wrapping Up</h2><p>${prose}</p></article>
<div class="more-from-author"><a href="https://medium.com/omarelgabrys-blog/kubernetes-basics-part-2-aaaa1111">Kubernetes basics (Part 2)</a><a href="https://medium.com/omarelgabrys-blog/consistent-hashing-beyond-the-basics-525304a12ba">Consistent hashing</a></div>
</body></html>`;
const cases = [
  [P[0], page(0, 'Database — Introduction (Part 1)', `This will take us to <a href="${B+P[1]}">the database fundamentals in the next tutorial</a>.`), B+P[1]],
  [P[1], page(1, 'Database — Fundamentals (Part 2)', `Next we will look at the design process.`), B+P[2]],
  [P[2], page(2, 'Database — Design Process (Part 3)', ``), B+P[3]],
  [P[4], page(4, 'Database — SQL (Part 8)', ``), null],
];
let ok = 0;
for (const [slug, html, want] of cases) {
  const url = B + slug;
  const doc = new JSDOM(html, { url }).window.document;
  const r = RFNext.find(doc, url, {});
  const got = r ? r.url : null; const pass = got === want; ok += pass;
  console.log(pass ? 'PASS' : 'FAIL', slug.split('-part')[0], '->', got && got.replace(B, ''), r ? `(${r.score}: ${r.reason})` : '');
}
console.log(ok + '/' + cases.length);
