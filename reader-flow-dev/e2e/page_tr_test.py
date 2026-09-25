import asyncio, json, sys
from playwright.async_api import async_playwright
from e2e import open_reader, SH, EXT, scroll_to_page
MODEL = sys.argv[1] if len(sys.argv) > 1 else 'mock'
CHUNK = sys.argv[2] if len(sys.argv) > 2 else '4000'
async def main():
    open('/tmp/llm_requests.jsonl','w').close()
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/rfprof6', headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width':1000,'height':800})
        page = ctx.pages[0]
        errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('http://127.0.0.1:8765/article?page=1')
        sw = await open_reader(ctx, page)
        await sw.evaluate(f"() => chrome.storage.local.set({{uiLang:'vi', trEndpoint:'http://127.0.0.1:8765', trModel:'{MODEL}', trChunkChars: {CHUNK}}})")
        await page.wait_for_timeout(300)
        await page.evaluate(f"() => {SH}.querySelector('.rf-trbtn').click()")
        await page.wait_for_timeout(4000)
        await scroll_to_page(page, 1); await page.wait_for_timeout(4000)
        q = f"""() => {{ const r={SH}; return [...r.querySelectorAll('.rf-page')].map(s => ({{
             idx: s.dataset.idx, blocks: s.querySelectorAll('.rf-has-tr').length,
             done: [...s.querySelectorAll('.rf-tr')].filter(t=>t.textContent && !t.classList.contains('rf-tr-pending') && !t.classList.contains('rf-tr-error')).length,
             errors: s.querySelectorAll('.rf-tr-error').length,
             ctx: (s.querySelector('.rf-ctx div')||{{}}).textContent || null,
             linkOk: !!s.querySelector('.rf-tr a b'),
             sample: ((s.querySelectorAll('.rf-article .rf-tr')[0]||{{}}).textContent||'').slice(0,50) }})) }}"""
        print(json.dumps(await page.evaluate(q), ensure_ascii=False, indent=0))
        print('STATUS', await page.evaluate(f"() => {SH}.querySelector('.rf-trstat').textContent"))
        await page.screenshot(path='page_tr.png')
        print('errors', errs)
        await ctx.close()
    reqs = [json.loads(l) for l in open('/tmp/llm_requests.jsonl')]
    print('REQUESTS', len(reqs))
    for r in reqs:
        u = r['messages'][-1]['content']; sysm = r['messages'][0]['content'] if r['messages'][0]['role']=='system' else ''
        kind = 'SUMMARY' if 'running summary' in sysm else 'TRANSLATE'
        print(' ', kind, 'msgs=%d' % len(r['messages']), 'segs=%d' % u.count('</s'), 'hasSummaryCtx=%s' % ('MOCK SUMMARY' in u), 'prev=%s' % ('The text just before' in u))
asyncio.run(main())
