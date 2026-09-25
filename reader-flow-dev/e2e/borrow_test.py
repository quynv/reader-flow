import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprofB', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--autoplay-policy=no-user-gesture-required'], viewport={'width':1000,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8765/livehls'); await page.wait_for_timeout(1500)
        print('page video src:', await page.evaluate("() => document.getElementById('v').src.slice(0,30)"))
        sw = await open_reader(ctx, page); await page.wait_for_timeout(2000)
        st = lambda: page.evaluate(f"""() => {{ const r={SH}; const a=r.querySelector('.rf-article'); const v=a.querySelector('.rf-borrowed video');
            return {{ borrowed: !!v, sameEl: v === document.getElementById('v') || (v && v.id === 'v'), missing: a.querySelectorAll('.rf-media-missing').length,
                     pipBtn: !!a.querySelector('.rf-borrowed-tools button'), junk: /Current Time/.test(a.innerText),
                     inPage: !!document.querySelector('#box #v') }} }}""")
        print('IN READER', json.dumps(await st()))
        res = await page.evaluate(f"""async () => {{ const v={SH}.querySelector('.rf-borrowed video'); v.muted = true;
            const r = await Promise.race([v.play().then(() => 'ok', e => 'err ' + e.message), new Promise(r => setTimeout(() => r('timeout'), 4000))]);
            await new Promise(r => setTimeout(r, 1200)); const out = {{ play: r, t: +v.currentTime.toFixed(2) }}; v.pause(); return out; }}""")
        print('PLAY IN READER', json.dumps(res))
        # close reader: video must go back into its original container and still play
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
        back = await page.evaluate("""async () => { const v = document.querySelector('#box #v'); if (!v) return 'not returned';
            const t0 = v.currentTime; await v.play(); await new Promise(r => setTimeout(r, 800)); v.pause();
            return { returned: true, controlsRestored: !v.hasAttribute('controls'), styleRestored: !v.hasAttribute('style'), advanced: v.currentTime > t0, tag: v.hasAttribute('data-rf-vid') }; }""")
        print('AFTER CLOSE', json.dumps(back))
        # reopen and simulate the site ripping the element away -> PiP fallback box
        await open_reader(ctx, page); await page.wait_for_timeout(2000)
        await page.evaluate(f"() => {{ const v={SH}.querySelector('.rf-borrowed video'); document.getElementById('box').appendChild(v); }}")
        await page.wait_for_timeout(300)
        print('SITE TOOK IT BACK', json.dumps(await page.evaluate(f"""() => {{ const a={SH}.querySelector('.rf-article');
            return {{ borrowed: !!a.querySelector('.rf-borrowed'), fallback: !!a.querySelector('.rf-media-missing button'), btn: (a.querySelector('.rf-media-missing button')||{{}}).textContent }} }}""")))
        await page.evaluate(f"() => [...{SH}.querySelectorAll('.rf-media-missing button')].find(b => /page|trang/i.test(b.textContent)).click()")
        await page.wait_for_timeout(300)
        peek = await page.evaluate("() => ({ readerHidden: document.querySelector('rf-reader-host').style.display === 'none', pill: [...document.querySelectorAll('button')].some(b => b.textContent.includes('←')) })")
        await page.evaluate("() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('←')).click()")
        await page.wait_for_timeout(200)
        back = await page.evaluate("() => document.querySelector('rf-reader-host').style.display")
        print('PEEK', json.dumps(peek), '| back to reader:', back == 'block')
        print('errors', errs)
        await ctx.close()
asyncio.run(main())
