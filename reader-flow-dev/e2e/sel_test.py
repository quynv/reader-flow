import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT
SEL = "document.querySelector('rf-sel-host').shadowRoot"
async def main():
    open('/tmp/llm_requests.jsonl','w').close()
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprofS', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width':1000,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        # (a) normal page, reader never opened
        await page.goto('http://127.0.0.1:8765/vi/1')
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
        for _ in range(20):
            if await sw.evaluate("() => !!(self.chrome && chrome.tabs)"): break
            await asyncio.sleep(0.25)
        await sw.evaluate("() => chrome.storage.local.set({uiLang:'vi', trEndpoint:'http://127.0.0.1:8765', trModel:'mock', trTargetLang:'English'})")
        menu = await sw.evaluate("() => new Promise(r => chrome.contextMenus.update('rf-translate-sel', {}, () => r(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'exists')))")
        print('context menu item:', menu)
        await page.evaluate("""() => { const p = document.querySelector('article p'); const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 60);
            const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
        text = await page.evaluate("() => getSelection().toString()")
        await sw.evaluate(f"""async () => {{ const [t] = await chrome.tabs.query({{active:true, lastFocusedWindow:true}}); await sendToFrame(t, 0, {{type:'rf-translate-selection', text: {json.dumps(text)} }}); }}""")
        await page.wait_for_timeout(1500)
        info = await page.evaluate(f"""() => ({{ reader: !!document.querySelector('rf-reader-host'), popup: !!document.querySelector('rf-sel-host'),
            out: {SEL}.querySelector('.out').textContent, title: {SEL}.querySelector('.title').textContent,
            box: (() => {{ const b = {SEL}.querySelector('.box').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width)]; }})() }})""")
        print('NORMAL PAGE', json.dumps(info, ensure_ascii=False))
        await page.screenshot(path='sel_normal.png')
        await page.keyboard.press('Escape'); await page.wait_for_timeout(200)
        print('closed by Esc:', not await page.evaluate("() => !!document.querySelector('rf-sel-host')"))
        # (b) inside reader mode (shadow DOM selection, with page context)
        await open_reader(ctx, page); await page.wait_for_timeout(1500)
        await page.evaluate(f"""() => {{ const root = document.querySelector('rf-reader-host').shadowRoot; const p = root.querySelectorAll('.rf-article p')[1];
            const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 40); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }}""")
        await sw.evaluate("""async () => { const [t] = await chrome.tabs.query({active:true, lastFocusedWindow:true}); await sendToFrame(t, 0, {type:'rf-translate-selection', text: 'Đoạn 2 của trang 1. Buổi sáng ở thị trấn'}); }""")
        await page.wait_for_timeout(1500)
        info = await page.evaluate(f"() => ({{ reader: !!document.querySelector('rf-reader-host'), out: {SEL}.querySelector('.out').textContent }})")
        print('IN READER', json.dumps(info, ensure_ascii=False))
        await page.screenshot(path='sel_reader.png')
        await page.mouse.click(20, 400); await page.wait_for_timeout(200)
        print('closed by outside click:', not await page.evaluate("() => !!document.querySelector('rf-sel-host')"))
        reqs = [json.loads(l) for l in open('/tmp/llm_requests.jsonl')]
        print('requests', len(reqs), '| title ctx in prompt:', ['Thị trấn' in r['messages'][-1]['content'] for r in reqs])
        print('errors', errs)
        await ctx.close()
asyncio.run(main())
