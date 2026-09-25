import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprofSS', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width':1000,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8765/substack?v=3')
        await open_reader(ctx, page); await page.wait_for_timeout(2000)
        print(json.dumps(await page.evaluate(f"""() => {{ const a={SH}.querySelector('.rf-article');
          return {{ head: {SH}.querySelector('.rf-page-head').innerText, firstTag: a.querySelector('figure') && a.querySelector('figure').firstElementChild.tagName,
            videos: a.querySelectorAll('video').length, audios: a.querySelectorAll('audio').length,
            firstPara: (a.querySelector(':scope p') || {{}}).textContent,
            transcript: !!a.querySelector('details.rf-transcript'), transcriptOpen: !!a.querySelector('details.rf-transcript[open]'),
            visibleText: a.innerText.slice(0, 160), junk: /Playback speed|Generate transcript/.test(a.innerText) }} }}"""), ensure_ascii=False, indent=1))
        print('errors', errs)
        await ctx.close()
asyncio.run(main())
