import asyncio, json, sys
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprofW', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--autoplay-policy=no-user-gesture-required'], viewport={'width':1100,'height':800})
        page = ctx.pages[0]
        for path in sys.argv[1:]:
            errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
            await page.goto('http://127.0.0.1:8765/' + path); await page.wait_for_timeout(1200)
            await open_reader(ctx, page); await page.wait_for_timeout(1800)
            info = await page.evaluate(f"""() => {{ const a={SH}.querySelector('.rf-article');
              return {{ videos: [...a.querySelectorAll('video')].map(v => (v.closest('.rf-borrowed') ? 'BORROWED ' : '') + (v.currentSrc || (v.querySelector('source')||{{}}).src || v.getAttribute('data-rf-hls') || '').replace('http://127.0.0.1:8765','')),
                        audios: [...a.querySelectorAll('audio')].map(v => (v.currentSrc || (v.querySelector('source')||{{}}).src || '').replace('http://127.0.0.1:8765','')),
                        iframes: [...a.querySelectorAll('iframe')].map(f => f.src), missing: a.querySelectorAll('.rf-media-missing').length,
                        junk: (a.innerText.match(/00:00|Current Time|Duration|Play Video|Try it Yourself/g) || []).join(',') }} }}""")
            print(path.ljust(6), json.dumps(info))
            await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
        await ctx.close()
asyncio.run(main())
