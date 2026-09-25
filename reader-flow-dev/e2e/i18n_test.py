import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT, state, scroll_to_page
async def labels(page):
    return await page.evaluate(f"""() => {{ const r={SH}; return {{
      settings: r.querySelector('.rf-bar .rf-opt[aria-pressed]').textContent,
      trbtn: r.querySelector('.rf-trbtn').textContent,
      status: r.querySelector('.rf-status').textContent, counter: r.querySelector('.rf-counter').textContent,
      seam: [...r.querySelectorAll('.rf-seam')].map(s=>s.getAttribute('aria-label')),
      panelFirst: r.querySelector('.rf-panel label').textContent, lang: r.querySelector('.rf-root').lang }} }}""")
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprof4', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width':1100,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8765/article?page=1')
        sw = await open_reader(ctx, page); await page.wait_for_timeout(1500)
        await scroll_to_page(page, 1); await page.wait_for_timeout(1000)
        print('AUTO(en)', json.dumps(await labels(page), ensure_ascii=False))
        # switch via panel select to ja
        await page.evaluate(f"""() => {{ const r={SH}; r.querySelector('.rf-opt[aria-pressed]').click(); const sel=[...r.querySelectorAll('.rf-panel select')].find(s=>[...s.options].some(o=>o.value==='ja')); sel.value='ja'; sel.dispatchEvent(new Event('change')); }}""")
        await page.wait_for_timeout(800)
        print('JA', json.dumps(await labels(page), ensure_ascii=False))
        await page.screenshot(path='i18n_ja.png')
        # switch from options page to vi
        await sw.evaluate("() => chrome.storage.local.set({uiLang:'vi'})"); await page.wait_for_timeout(800)
        print('VI', json.dumps(await labels(page), ensure_ascii=False))
        print('target lang default', await sw.evaluate("async () => (await rfLoadSettings()).trTargetLang"))
        # options page
        op = await ctx.new_page()
        ext_id = sw.url.split('/')[2]
        await op.goto(f'chrome-extension://{ext_id}/options.html'); await op.wait_for_timeout(800)
        print('OPTIONS', await op.title(), '|', await op.locator('h2').all_inner_texts())
        await op.select_option('#uiLang', 'ja'); await op.wait_for_timeout(600)
        print('OPTIONS JA', await op.title(), '|', await op.locator('h2').all_inner_texts())
        await op.screenshot(path='i18n_opts.png', full_page=True)
        # error message path localized (background)
        await sw.evaluate("() => chrome.storage.local.set({trEndpoint:'http://127.0.0.1:9', trModel:'x'})")
        await op.click('#testBtn'); await op.wait_for_timeout(1500)
        print('TEST ERR', await op.locator('#testOut').inner_text())
        print('page errors', errs)
        await ctx.close()
asyncio.run(main())
