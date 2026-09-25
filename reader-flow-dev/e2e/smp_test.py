import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT
def frame(page): return next(f for f in page.frames if '/emp/SMPj/' in f.url)
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprofSMP', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--autoplay-policy=no-user-gesture-required'], viewport={'width':1000,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8765/smp'); await page.wait_for_timeout(1200)
        tok0 = await frame(page).evaluate("() => window.__token")
        await open_reader(ctx, page); await page.wait_for_timeout(1800)
        info = await page.evaluate(f"""() => {{ const r={SH}; const f = r.querySelector('.rf-article iframe');
            return {{ inReader: !!f, same: f === window.__smp, hint: !!r.querySelector('.rf-borrowed-tools .rf-hint'), leftInPage: !!document.querySelector('#smpbox iframe') }} }}""")
        fr = frame(page)
        st = await fr.evaluate("async () => { const v = document.querySelector('video'); if (!v) return 'no video'; v.muted = true; await v.play(); await new Promise(r => setTimeout(r, 1000)); v.pause(); return { token: window.__token, t: +v.currentTime.toFixed(2) }; }")
        await page.wait_for_timeout(500)
        btn = await frame(page).evaluate("() => { const h = [...document.body.children].find(e => (e.getAttribute('style')||'').includes('right: 8px')); return !!h; }")
        # bấm vào nút (nằm trong shadow đóng) theo toạ độ góc trên phải của iframe
        box = await page.evaluate(f"() => {{ const r = {SH}.querySelector('.rf-article iframe').getBoundingClientRect(); return [r.right, r.top]; }}")
        await page.mouse.click(box[0] - 22, box[1] + 22); await page.wait_for_timeout(600)
        pip = await frame(page).evaluate("() => !!document.pictureInPictureElement")
        print('PIP BUTTON in frame:', btn, '| PiP opened after click:', pip)
        print('IN READER', json.dumps(info), '| iframe state:', json.dumps(st), '| not reloaded:', st != 'no video' and st['token'] == tok0)
        await open_reader(ctx, page); await page.wait_for_timeout(400)   # bấm lại nút tiện ích = đóng chế độ đọc
        back = await page.evaluate("() => ({ returned: !!document.querySelector('#smpbox iframe'), same: document.querySelector('#smpbox iframe') === window.__smp })")
        tok2 = await frame(page).evaluate("() => [window.__token, !!document.querySelector('video')]")
        print('AFTER CLOSE', json.dumps(back), '| still same frame state:', tok2[0] == tok0 and tok2[1])
        print('errors', errs)
        await ctx.close()
asyncio.run(main())
