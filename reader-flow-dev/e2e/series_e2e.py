import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT, state, scroll_to_page
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprofR', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width':1000,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8765/series/database-introduction-part-1-4844')
        await open_reader(ctx, page); await page.wait_for_timeout(1500)
        await scroll_to_page(page, 1); await page.wait_for_timeout(1500)
        st = await state(page)
        print('pages:', [(x['idx'], x['seam']) for x in st['pages']], '|', st['status'])
        tocs = await page.evaluate(f"() => [...{SH}.querySelectorAll('.rf-page')].map(s => s.querySelectorAll('.rf-article ul').length)")
        print('TOC lists per page:', tocs)
        print('errors', errs)
        await ctx.close()
asyncio.run(main())
