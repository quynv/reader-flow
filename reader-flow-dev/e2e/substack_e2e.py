import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprofSS', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--autoplay-policy=no-user-gesture-required'], viewport={'width':1000,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        import sys
        await page.goto('http://127.0.0.1:8765/substack' + (('?v=' + sys.argv[1]) if len(sys.argv) > 1 else ''))
        await open_reader(ctx, page); await page.wait_for_timeout(2500)
        info = await page.evaluate(f"""() => {{ const a={SH}.querySelector('.rf-article');
          return {{ first: a.firstElementChild && a.firstElementChild.outerHTML.slice(0, 160),
                    videos: [...a.querySelectorAll('video')].map(v => ({{ src: v.currentSrc.slice(0, 70), hls: v.getAttribute('data-rf-hls'), poster: !!v.poster }})),
                    iframes: [...a.querySelectorAll('iframe')].map(f => f.src), junk: /Playback speed|Generate transcript/.test(a.innerText) }} }}""")
        print(json.dumps(info, indent=1))
        res = await page.evaluate(f"""async () => {{ const vs = [...{SH}.querySelectorAll('.rf-article video')]; const out = [];
            for (const v of vs) {{ v.muted = true; const r = await Promise.race([v.play().then(() => 'ok', e => 'err ' + e.message), new Promise(r => setTimeout(() => r('timeout'), 5000))]);
              await new Promise(r => setTimeout(r, 1200)); out.push({{ play: r, t: +v.currentTime.toFixed(2), hls: v.getAttribute('data-rf-hls') }}); v.pause(); }}
            return out; }}""")
        print('PLAYBACK', json.dumps(res))
        print('errors', errs)
        await ctx.close()
asyncio.run(main())
