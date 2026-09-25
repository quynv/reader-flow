import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT, state
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprof3', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width':1100,'height':800})
        page = ctx.pages[0]
        await page.goto('http://127.0.0.1:8765/weird/1')
        await open_reader(ctx, page); await page.wait_for_timeout(1200)
        st = await state(page); print('BEFORE', len(st['pages']), '|', st['status'])
        await page.evaluate(f"""() => [...{SH}.querySelectorAll('.rf-status button')].find(b=>(b.textContent.includes('Chọn') || b.textContent.includes('Pick'))).click()""")
        await page.wait_for_timeout(300)
        box = await page.locator("a:has-text('go on')").bounding_box()
        await page.mouse.move(box['x']+5, box['y']+5); await page.mouse.click(box['x']+5, box['y']+5)
        await page.wait_for_timeout(2500)
        st = await state(page); print('AFTER PICK', len(st['pages']), [p['seam'] for p in st['pages']], '|', st['status'])
        sw = ctx.service_workers[0]
        print('RULES', await sw.evaluate("() => chrome.storage.local.get('siteRules')"))
        print('URL still', page.url)
        await page.evaluate(f"""() => {{ const r={SH}; const s=r.querySelector('.rf-scroll'); const p=r.querySelectorAll('.rf-page')[1]; s.scrollTop=p.offsetTop - 250; }}""")
        await page.wait_for_timeout(300); await page.screenshot(path='s5_seam.png')
        await ctx.close()
asyncio.run(main())
