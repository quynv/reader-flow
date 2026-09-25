import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprofV', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--autoplay-policy=no-user-gesture-required'], viewport={'width':1000,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8765/kenh')
        await open_reader(ctx, page); await page.wait_for_timeout(2500)
        info = await page.evaluate(f"""() => {{ const r={SH}; const a = r.querySelector('.rf-article');
            return {{ videos: [...a.querySelectorAll('video')].map(v => ({{ src: v.currentSrc || (v.querySelector('source')||{{}}).src || null, hls: v.getAttribute('data-rf-hls'), ready: v.readyState }})),
                     missing: a.querySelectorAll('.rf-media-missing').length, junk: /Current Time|Duration/.test(a.innerText) }} }}""")
        print('BEFORE PLAY', json.dumps(info))
        # play both videos
        res = await page.evaluate(f"""async () => {{ const vs = [...{SH}.querySelectorAll('.rf-article video')]; const out = [];
            out.push('h264 support: ' + vs[0].canPlayType('video/mp4; codecs="avc1.42E01E"') + ' / MSE ' + (window.MediaSource && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"')));
            for (const v of vs) {{ v.muted = true; const p = v.play().then(() => 'ok', e => 'err ' + e.message);
              const r = await Promise.race([p, new Promise(r => setTimeout(() => r('timeout'), 4000))]);
              await new Promise(r => setTimeout(r, 1200));
              out.push({{ play: r, t: +v.currentTime.toFixed(2), ready: v.readyState, dur: v.duration, err: v.error && v.error.code }}); v.pause(); }}
            return out; }}""")
        print('PLAYBACK', json.dumps(res))
        print('errors', errs)
        await ctx.close()
asyncio.run(main())
