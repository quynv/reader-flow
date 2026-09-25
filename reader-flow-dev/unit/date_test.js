const fs=require('fs'); const {JSDOM}=require('jsdom'); const w=new JSDOM('').window;
global.DOMParser=w.DOMParser; global.rfT=k=>k; global.document=w.document;
eval(fs.readFileSync(require('path').join(__dirname, '..', '..', 'reader-flow', 'lib', 'extract.js'),'utf8'));
const cases=[['2026年9月25日 5時00分',1],['2026年9月25日 5時00分 更新',1],['Thứ năm, 25/9/2026, 05:00 (GMT+7)',1],['Updated Sep 25, 2026 5:00 PM EDT',1],
['25 September 2026',1],['Published: 2026-09-25',1],['ngày 25 tháng 9 năm 2026',1],['The river town woke slowly on 25/9/2026 at noon.',0],
['１９７３年に決まった整備新幹線の路線のうち',0],['Chapter 3',0]];
let ok=0; for (const [t,exp] of cases){ const html=`<p>${t}</p><p>${'Body text long enough. '.repeat(10)}</p>`; const r=RFExtract.postClean(html,{siteName:'',byline:'',title:''},{}); const removed = !r.html.includes(t); const pass = removed===!!exp; ok+=pass; console.log(pass?'PASS':'FAIL', JSON.stringify(t), removed?'removed':'kept', r.date?('date='+r.date):''); }
console.log(ok+'/'+cases.length);
