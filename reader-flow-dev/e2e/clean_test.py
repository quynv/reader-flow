import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprof7', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width':1000,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8765/asahi')
        sw = await open_reader(ctx, page)
        await sw.evaluate("() => chrome.storage.local.set({uiLang:'vi', trEndpoint:'http://127.0.0.1:8765', trModel:'bracket'})")
        await page.wait_for_timeout(1500)
        info = lambda: page.evaluate(f"""() => {{ const r={SH}; return {{
            head: r.querySelector('.rf-page-head').innerText, article: r.querySelector('.rf-article').innerText.slice(0,120),
            lis: r.querySelectorAll('.rf-article li').length, pr: /\\[PR\\]/.test(r.querySelector('.rf-article').innerText),
            h2dup: !!r.querySelector('.rf-article h2') }} }}""")
        print('CLEAN', json.dumps(await info(), ensure_ascii=False))
        # translation with bracket-style tags
        await page.evaluate(f"""() => {{ {SH}.querySelector('.rf-trbtn').click(); }}""")
        await page.wait_for_timeout(2500)
        tr = await page.evaluate(f"""() => [...{SH}.querySelectorAll('.rf-tr')].map(t=>t.textContent.slice(0,40))""")
        print('TR', json.dumps(tr, ensure_ascii=False))
        await page.screenshot(path='clean.png')
        # zap the second paragraph (pretend it is clutter)
        await page.evaluate(f"""() => {{ {SH}.querySelector('.rf-trbtn').click(); }}""")
        await page.evaluate(f"""() => {{ const r={SH}; r.querySelector('.rf-opt[aria-pressed]').click(); [...r.querySelectorAll('.rf-panel button')].find(b=>b.textContent.includes('Ẩn')).click(); }}""")
        await page.wait_for_timeout(200)
        await page.screenshot(path='zap_mode.png')
        target = await page.evaluate(f"""() => {{ const p={SH}.querySelectorAll('.rf-article p')[1]; p.dispatchEvent(new MouseEvent('mouseover', {{bubbles:true}})); p.click(); return p.isConnected; }}""")
        await page.wait_for_timeout(300)
        rules = await sw.evaluate("() => chrome.storage.local.get('siteRules')")
        print('ZAP removed:', not target, 'saved:', [len(t) for t in rules['siteRules']['127.0.0.1']['removeTexts']])
        await page.keyboard.press('Escape'); await page.wait_for_timeout(200)
        # reopen: hidden text must stay hidden
        await page.reload(); await page.wait_for_timeout(500)
        await open_reader(ctx, page); await page.wait_for_timeout(1500)
        n = await page.evaluate(f"() => {SH}.querySelectorAll('.rf-article p').length")
        print('AFTER RELOAD paragraphs:', n, '| note:', await page.evaluate(f"() => {SH}.querySelector('.rf-panel .rf-hint:last-of-type') && [...{SH}.querySelectorAll('.rf-panel .rf-hint')].map(x=>x.textContent).pop()"))
        print('errors', errs)
        await ctx.close()
asyncio.run(main())
