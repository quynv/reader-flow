import asyncio, json
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT
MOCK = """() => {
  globalThis.__rfSpoken = [];
  let cur = null;
  globalThis.__rfUtterance = class { constructor(t) { this.text = t; } };
  globalThis.__rfSynth = {
    getVoices: () => [{voiceURI:'mock-vi', name:'Mock vi', lang:'vi-VN', localService:true},
                      {voiceURI:'mock-en', name:'Mock en', lang:'en-US', localService:true},
                      {voiceURI:'mock-en-nat', name:'Mock Natural en', lang:'en-GB', localService:false}],
    addEventListener() {},
    cancel() { if (cur) { const u = cur; cur = null; clearTimeout(u._t); u.onerror && u.onerror({error:'interrupted'}); } },
    speak(u) { cur = u; globalThis.__rfSpoken.push({text: u.text.slice(0, 40), lang: u.lang, voice: u.voice.voiceURI, rate: u.rate});
               u._t = setTimeout(() => { if (cur === u) { cur = null; u.onend && u.onend(); } }, 15); }
  };
}"""
async def iso(sw, fn):
    return await sw.evaluate(f"""async () => {{ const [t] = await chrome.tabs.query({{active:true, lastFocusedWindow:true}});
        const [r] = await chrome.scripting.executeScript({{target:{{tabId:t.id}}, world:'ISOLATED', func: {fn} }}); return r.result; }}""")
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprof8', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width':1000,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8765/article?page=1')
        sw = await open_reader(ctx, page)
        await sw.evaluate("() => chrome.storage.local.set({uiLang:'vi', maxPages:3, trEndpoint:'http://127.0.0.1:8765', trModel:'mock'})")
        print('real voices in headless:', await iso(sw, "() => speechSynthesis.getVoices().length"))
        await iso(sw, MOCK)
        await page.wait_for_timeout(1200)
        st = lambda: page.evaluate(f"""() => {{ const r={SH}; return {{ player: !r.querySelector('.rf-player').hidden,
            btn: r.querySelector('.rf-tts-main').getAttribute('aria-label'), stat: r.querySelector('.rf-tts-stat').textContent,
            speaking: (r.querySelector('.rf-speaking')||{{}}).textContent?.slice(0,30) || null, pages: r.querySelectorAll('.rf-page').length }} }}""")
        await page.evaluate(f"() => {SH}.querySelector('.rf-listen').click()")
        await page.wait_for_timeout(400)
        print('PLAYING', await st())
        await page.screenshot(path='tts_playing.png')
        await page.evaluate(f"() => {SH}.querySelector('.rf-tts-main').click()")
        n1 = len(await iso(sw, "() => __rfSpoken")); await page.wait_for_timeout(500); n2 = len(await iso(sw, "() => __rfSpoken"))
        print('PAUSED', await st(), 'no new speech while paused:', n1 == n2)
        await page.evaluate(f"() => {SH}.querySelector('.rf-tts-main').click()")
        await page.wait_for_timeout(15000)
        spoken = await iso(sw, "() => __rfSpoken")
        print('END', await st(), '| utterances:', len(spoken))
        print('  first:', spoken[0], '\n  last:', spoken[-1])
        print('  pages read:', sorted({s['text'][:6] for s in spoken if s['text'].startswith('Page')}))
        # read translations in bilingual mode
        await iso(sw, "() => { __rfSpoken.length = 0; }")
        await page.evaluate(f"""() => {{ const r={SH}; r.querySelector('.rf-trbtn').click();
             r.querySelector('.rf-scroll').scrollTop = 0; }}""")
        await page.wait_for_timeout(300)
        await page.evaluate(f"""() => {{ const r={SH}; const p=r.querySelectorAll('.rf-article p')[2]; p.dispatchEvent(new MouseEvent('dblclick', {{bubbles:true}})); }}""")
        await page.wait_for_timeout(2500)
        spoken = await iso(sw, "() => __rfSpoken")
        print('TRANSLATION READ', spoken[:2])
        await page.evaluate(f"() => {SH}.querySelector('.rf-player button[aria-label=\"Dừng đọc\"]').click()")
        await page.wait_for_timeout(200)
        print('CLOSED', await st())
        print('errors', errs)
        await ctx.close()
asyncio.run(main())
