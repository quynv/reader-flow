import asyncio
from playwright.async_api import async_playwright
from e2e import EXT
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprofA', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
        ext = sw.url.split('/')[2]
        # người dùng nâng cấp từ bản cũ, từng để chế độ song ngữ
        await sw.evaluate("() => chrome.storage.local.set({trMode:'bilingual'})")
        op = ctx.pages[0]
        await op.goto(f'chrome-extension://{ext}/options.html'); await op.wait_for_timeout(800)
        box = op.locator('[data-key="trAuto"]')
        print('after upgrade: checked =', await box.is_checked(), '| stored:', await sw.evaluate("() => chrome.storage.local.get(['trMode','trAuto','trDisplay'])"))
        await box.uncheck(); await op.wait_for_timeout(300)
        for i in range(2):
            await op.reload(); await op.wait_for_timeout(800)
            print(f'reload {i+1}: checked =', await op.locator('[data-key="trAuto"]').is_checked(), '| stored:', await sw.evaluate("() => chrome.storage.local.get(['trMode','trAuto'])"))
        await op.locator('[data-key="trAuto"]').check(); await op.wait_for_timeout(300); await op.reload(); await op.wait_for_timeout(800)
        print('re-checked persists:', await op.locator('[data-key="trAuto"]').is_checked())
        await ctx.close()
asyncio.run(main())
