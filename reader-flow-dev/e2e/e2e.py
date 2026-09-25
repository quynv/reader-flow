import asyncio, json, sys
from playwright.async_api import async_playwright
import os
EXT=os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'reader-flow'))
async def open_reader(ctx, page):
    sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
    for _ in range(20):
        if await sw.evaluate("() => !!(self.chrome && chrome.tabs)"): break
        await asyncio.sleep(0.25)
    await sw.evaluate("""async () => { const [t] = await chrome.tabs.query({active:true, lastFocusedWindow:true}); await toggleReader(t); }""")
    return sw
SH = "document.querySelector('rf-reader-host').shadowRoot"
async def state(page):
    return await page.evaluate(f"""() => {{ const r={SH};
      return {{pages:[...r.querySelectorAll('.rf-page')].map(s=>({{idx:s.dataset.idx, seam:(s.querySelector('.rf-seam-title')||{{}}).textContent, text:s.querySelector('.rf-article').textContent.slice(0,60), imgs:s.querySelectorAll('img').length, videos:s.querySelectorAll('video').length, audios:s.querySelectorAll('audio').length, iframes:[...s.querySelectorAll('iframe')].map(f=>f.src)}})),
               status:r.querySelector('.rf-status').textContent, counter:r.querySelector('.rf-counter').textContent}} }}""")
async def scroll_to_page(page, i):
    await page.evaluate(f"""() => {{ const r={SH}; const s=r.querySelector('.rf-scroll'); const p=r.querySelectorAll('.rf-page')[{i}]; s.scrollTop=p.offsetTop+10; s.dispatchEvent(new Event('scroll')); }}""")
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprof', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width':1100,'height':800})
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        page.on('console', lambda m: print('  [console]', m.text) if 'Reader' in m.text or m.type=='error' else None)
        await page.goto('http://127.0.0.1:8765/article?page=1')
        sw = await open_reader(ctx, page)
        await page.wait_for_timeout(1500)
        st = await state(page); print('AFTER OPEN', json.dumps(st, ensure_ascii=False, indent=1))
        await scroll_to_page(page, 1); await page.wait_for_timeout(1200)
        st = await state(page); print('AFTER SCROLL TO 2: pages', len(st['pages']), st['counter'], '|', st['status'])
        await scroll_to_page(page, 2); await page.wait_for_timeout(1200)
        st = await state(page); print('AFTER SCROLL TO 3: pages', len(st['pages']), st['counter'], '|', st['status'])
        await page.screenshot(path='shot_article.png')
        # translation with mock ollama
        await sw.evaluate("""() => chrome.storage.local.set({trEndpoint:'http://127.0.0.1:8765', trModel:'mock:1b'})""")
        await page.wait_for_timeout(300)
        await page.evaluate(f"""() => {{ {SH}.querySelector('.rf-trbtn').click(); }}""")
        await page.wait_for_timeout(3000)
        tr = await page.evaluate(f"""() => {{ const r={SH}; const t=[...r.querySelectorAll('.rf-tr')]; return {{n:t.length, sample:t.slice(0,2).map(x=>x.innerHTML.slice(-200)), errs:r.querySelectorAll('.rf-tr-error').length, stat:r.querySelector('.rf-trstat').textContent}} }}""")
        print('TRANSLATE', json.dumps(tr, ensure_ascii=False, indent=1))
        await page.screenshot(path='shot_bilingual.png')
        await page.evaluate(f"""() => {{ {SH}.querySelector('.rf-trbtn').click(); }}""")
        # Japanese Shift_JIS
        await page.goto('http://127.0.0.1:8765/jp/1.html')
        await open_reader(ctx, page); await page.wait_for_timeout(1500)
        await scroll_to_page(page, 1); await page.wait_for_timeout(1200)
        st = await state(page); print('JP', json.dumps(st, ensure_ascii=False, indent=1))
        # SPA / JS render fallback
        await page.goto('http://127.0.0.1:8765/spa/1')
        await page.wait_for_timeout(600)
        await open_reader(ctx, page); await page.wait_for_timeout(6000)
        st = await state(page); print('SPA', json.dumps(st, ensure_ascii=False, indent=1))
        await ctx.close()
if __name__=="__main__": asyncio.run(main())
