import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprof5', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width':1000,'height':760})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: print('  [console]', m.text) if 'Reader' in m.text else None)
        await page.goto('http://127.0.0.1:8765/vi/1')
        sw = await open_reader(ctx, page)
        await sw.evaluate("() => chrome.storage.local.set({uiLang:'vi'})")
        await page.wait_for_timeout(2000)
        info = await page.evaluate(f"""async () => {{ const r={SH}; await document.fonts.ready;
          const p=r.querySelector('.rf-article p'); const sec=r.querySelector('.rf-page');
          return {{lang: sec.lang, font: getComputedStyle(p).fontFamily.slice(0,40),
            faces:[...document.fonts].filter(f=>f.family.includes('RF')).map(f=>f.family+':'+f.style+':'+f.status).length,
            literataOk: document.fonts.check('16px "RF Literata"', 'Ước mơ'),
            h1lh: getComputedStyle(r.querySelector('.rf-page-head h1')).lineHeight }} }}""")
        print('FONT', info)
        await page.screenshot(path='vi_literata.png')
        await sw.evaluate("() => chrome.storage.local.set({fontFamily:'sans'})"); await page.wait_for_timeout(800)
        await page.screenshot(path='vi_inter.png')
        await sw.evaluate("() => chrome.storage.local.set({fontFamily:'serif', trEndpoint:'http://127.0.0.1:8765', trModel:'slow', trConcurrency:2})")
        await page.wait_for_timeout(300)
        await page.evaluate(f"""() => {{ {SH}.querySelector('.rf-trbtn').click(); }}""")
        await page.wait_for_timeout(1200)
        q = f"""() => {{ const r={SH}; return {{btn: r.querySelector('.rf-trbtn').textContent, hidden:r.querySelector('.rf-trbtn').hidden, stat:r.querySelector('.rf-trstat').textContent,
               pending:r.querySelectorAll('.rf-tr-pending').length, done:[...r.querySelectorAll('.rf-tr')].filter(t=>!t.classList.contains('rf-tr-pending')&&t.textContent).length, trs:r.querySelectorAll('.rf-tr').length}} }}"""
        print('RUNNING', await page.evaluate(q))
        await page.screenshot(path='vi_running.png')
        await page.evaluate(f"() => {SH}.querySelector('.rf-trbtn').click()")
        await page.wait_for_timeout(200); a = await page.evaluate(q); print('STOPPED', a)
        await page.wait_for_timeout(2500); print('STILL STOPPED', await page.evaluate(q))
        await page.screenshot(path='vi_stopped.png')
        await page.evaluate(f"() => {SH}.querySelector('.rf-trbtn').click()")
        await page.wait_for_timeout(1000); print('RESUMED', await page.evaluate(q))
        print('errors', errs)
        await ctx.close()
asyncio.run(main())
