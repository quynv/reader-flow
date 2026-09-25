import http.server, json, re, time, urllib.parse, os
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
REPO = os.path.abspath(os.path.join(HERE, '..', '..', 'reader-flow'))  # thư mục extension
NM = os.path.join(HERE, '..', 'node_modules')
LIBS = {  # thư viện player thật để dựng lại DOM của các trang (chạy npm install trong dev/)
  'video.min.js': f'{NM}/video.js/dist/video.min.js', 'video-js.min.css': f'{NM}/video.js/dist/video-js.min.css',
  'mediaelement-and-player.min.js': f'{NM}/mediaelement/build/mediaelement-and-player.min.js',
  'mediaelementplayer.min.css': f'{NM}/mediaelement/build/mediaelementplayer.min.css',
  'quality.min.js': f'{NM}/mediaelement-plugins/dist/quality/quality.min.js', 'quality.min.css': f'{NM}/mediaelement-plugins/dist/quality/quality.min.css',
}
LOREM = ("The river town woke slowly, fog pooling in the low streets while the bakers pulled the first trays of bread. "
         "Merchants argued about the price of salt, children raced along the canal, and an old ferryman counted coins twice. ")
def para(n, i): return f"<p>Page {n}, paragraph {i}. {LOREM*2} <a href='/x{i}'>a <b>bold</b> link</a> ends here.</p>"
def article(n, total=6):
    nav = []
    if n>1: nav.append(f"<a href='/article?page={n-1}' class='prev'>‹ Trang trước</a>")
    for k in range(1,total+1):
        nav.append(f"<span class='current'>{k}</span>" if k==n else f"<a href='/article?page={k}'>{k}</a>")
    if n<total: nav.append(f"<a href='/article?page={n+1}'>Trang sau ›</a>")
    media = ""
    if n==1:
        media = ("<figure><img src='/img/a.png' width='600' height='300' alt='hero'><figcaption>Harbour at dawn</figcaption></figure>"
                 "<img src='data:image/gif;base64,R0lGODlhAQABAAAAACw=' data-src='/img/lazy.png' width='600' height='300'>"
                 "<div class='video-wrap'><video controls poster='/img/poster.png'><source src='/media/clip.mp4' type='video/mp4'></video></div>"
                 "<iframe width='560' height='315' src='https://www.youtube.com/embed/dQw4w9WgXcQ'></iframe>"
                 "<audio controls src='/media/sound.mp3'></audio>")
    if n==2:
        media = "<div class='embed'><iframe src='https://player.vimeo.com/video/76979871' width='640' height='360'></iframe></div>"
    body = "".join(para(n,i) for i in range(1,5))
    return f"""<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'><title>River Town Chronicle - part {n}</title>
<meta property='og:site_name' content='Test Chronicle'></head><body>
<header><nav><a href='/'>Home</a> <a href='/about'>About</a> <a href='/next-gen'>Next generation products</a></nav></header>
<div class='ad banner'><iframe src='https://ads.example.com/x'></iframe></div>
<main><article><h1>River Town Chronicle</h1>{body[:len(body)//2]}{media}{body[len(body)//2:]}</article>
<div class='pagination'>{' '.join(nav)}</div></main>
<footer><a href='/privacy'>Privacy</a></footer></body></html>"""
def jp(n, total=3):
    nxt = f"<a href='/jp/{n+1}.html'>次へ</a>" if n<total else ""
    txt = "".join(f"<p>これは第{n}ページの{i}段落です。川の町はゆっくりと目を覚まし、霧が低い通りにたまっていた。パン屋は最初のパンを取り出し、商人たちは塩の値段について言い争った。</p>" for i in range(1,6))
    return f"<html><head><meta http-equiv='Content-Type' content='text/html; charset=Shift_JIS'><title>川の町 第{n}話</title></head><body><div id='main'><h1>川の町 第{n}話</h1>{txt}</div><div class='pager'>{nxt}</div></body></html>".encode('shift_jis')
def spa(n, total=3):
    nxt = f"<a href='/spa/{n+1}' rel='next'>Next</a>" if n<total else ""
    txt = "".join(para(n,i) for i in range(1,4)).replace("'", "\\'")
    return f"""<!DOCTYPE html><html><head><meta charset='utf-8'><title>SPA {n}</title></head><body><div id='app'></div>{nxt}
<script>setTimeout(()=>{{document.getElementById('app').innerHTML='<article><h1>SPA page {n}</h1>{txt}</article>';}},300);</script></body></html>"""
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a1b0c9e20000000049454e44ae426082')
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self, code, body, ctype):
        if isinstance(body,str): body=body.encode()
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin','*'); self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self):
        self.send_response(204); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Headers','*'); self.send_header('Access-Control-Allow-Methods','*'); self.end_headers()
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path=='/article': return self.send(200, article(int(q.get('page',['1'])[0])), 'text/html; charset=utf-8')
        m = re.match(r'/jp/(\d+)\.html', u.path)
        if m: return self.send(200, jp(int(m.group(1))), 'text/html')
        m = re.match(r'/spa/(\d+)', u.path)
        if m: return self.send(200, spa(int(m.group(1))), 'text/html; charset=utf-8')
        m = re.match(r'/weird/(\d+)', u.path)
        if m:
            n=int(m.group(1)); body="".join(para(n,i) for i in range(1,4))
            nxt = f"<div class='btns'><a class='b' href='/weird/{n-1}'>go back</a> <a class='b' href='/weird/{n+1}'>go on ▸▸</a></div>" if n<4 else ""
            return self.send(200, f"<html><head><meta charset='utf-8'><title>Weird {n}</title></head><body><article><h1>Weird {n}</h1>{body}</article>{nxt}</body></html>", 'text/html; charset=utf-8')
        m = re.match(r'/vi/(\d+)', u.path)
        if m:
            n=int(m.group(1))
            txt = "".join(f"<p>Đoạn {i} của trang {n}. Buổi sáng ở thị trấn ven sông thức dậy chậm rãi, sương mù đọng lại trên những con phố thấp. Người thợ bánh lấy mẻ bánh mì đầu tiên ra khỏi lò, còn các thương nhân tranh cãi về giá muối. Ông lái đò già đếm tiền hai lần rồi mới cất vào túi áo. Những đứa trẻ chạy dọc bờ kênh, tiếng cười vang vọng khắp các ngõ nhỏ.</p>" for i in range(1,6))
            nxt = f"<a href='/vi/{n+1}'>Trang sau »</a>" if n<3 else ""
            body = f"<html><head><meta charset='utf-8'><title>Thị trấn ven sông – Phần {n}</title></head><body><article><h1>Ước mơ của những người ở thị trấn ven sông – Phần {n}</h1>{txt}</article><div class='pagination'>{nxt}</div></body></html>".encode()
            self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Security-Policy', "default-src 'self'; font-src 'none'; style-src 'self'; img-src 'self'")
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        if u.path.startswith('/series/'):
            return self.send(200, open('series/' + u.path.split('/')[-1] + '.html', encoding='utf-8').read(), 'text/html; charset=utf-8')
        if u.path == '/substack':
            v = q.get('v',[''])[0]
            return self.send(200, open(f'substack{"_v"+v if v else ""}.html', encoding='utf-8').read(), 'text/html; charset=utf-8')
        m = re.match(r'/api/v1/video/upload/([0-9a-f-]+)/src', u.path)
        if m:
            t = q.get('type',['mp4'])[0]
            if m.group(1).startswith('0bad') and t == 'mp4': return self.send(404, 'no', 'text/plain')
            fp = 'media/clip.mp4' if t == 'mp4' else 'media/hls/master.m3u8'
            if t != 'mp4':
                body = open(fp).read().replace('init.mp4', '/media/hls/init.mp4').replace('master', '/media/hls/master')
                return self.send(200, body, 'application/vnd.apple.mpegurl')
            return self.send(200, open(fp,'rb').read(), 'video/mp4')
        if u.path == '/rf-hls.js':
            return self.send(200, open(os.path.join(REPO, 'lib', 'hls.light.min.js'),'rb').read(), 'application/javascript')
        if u.path == '/media/stream':
            body = open('media/hls/master.m3u8').read().replace('init.mp4', '/media/hls/init.mp4').replace('master', '/media/hls/master')
            return self.send(200, body, 'application/vnd.apple.mpegurl')
        if u.path == '/livehls':
            ps = ''.join(f"<p>Paragraph {i}. The river town woke slowly, fog pooling in the low streets while the bakers pulled the first trays of bread and merchants argued.</p>" for i in range(1,6))
            return self.send(200, f'''<html lang=en><head><meta charset=utf-8><title>Live HLS player</title><script src="/rf-hls.js"></script></head><body>
<article><h1>Live HLS player</h1>{ps}<div class="custom-player" id="box"><video id="v" playsinline></video><div class="ctl">Current Time 0:00 / Duration 0:06</div></div>{ps}</article>
<script>const h = new Hls(); h.loadSource('/media/stream?id=1'); h.attachMedia(document.getElementById('v'));</script></body></html>''', 'text/html; charset=utf-8')
        if u.path.startswith('/libs/'):
            fp = LIBS.get(u.path[6:])
            if not fp: return self.send(404, 'no', 'text/plain')
            return self.send(200, open(fp,'rb').read(), 'text/css' if fp.endswith('.css') else 'application/javascript')
        if u.path in ('/w3', '/vjs', '/mejs', '/mejs2', '/vjs10', '/ted', '/bbc', '/smp'):
            return self.send(200, open(u.path[1:] + '.html', encoding='utf-8').read(), 'text/html; charset=utf-8')
        if u.path in ('/embed/talk', '/ws/av-embeds/player'):
            return self.send(200, open('embed_talk.html').read(), 'text/html')
        if u.path.startswith('/emp/SMPj/'):
            return self.send(200, open('smpframe.html').read(), 'text/html')
        if u.path == '/asahi':
            return self.send(200, open('asahi.html', encoding='utf-8').read(), 'text/html; charset=utf-8')
        if u.path.startswith('/media/'):
            import os
            fp = '.' + u.path
            if os.path.isfile(fp):
                ct = 'audio/webm' if fp.endswith('.webm') else 'video/mp4' if fp.endswith(('.mp4', '.m4s')) else 'application/vnd.apple.mpegurl' if fp.endswith('.m3u8') else 'video/mp2t'
                return self.send(200, open(fp,'rb').read(), ct)
        if u.path == '/kenh':
            vid = "<div class='VCSortableInPreviewMode' type='VideoStream' data-vid='127.0.0.1:8765/media/clip.mp4'></div>"
            hls = "<div class='video-js'><video class='vjs-tech' src='blob:http://127.0.0.1:8765/x'></video><div class='vjs-control-bar'><span class='vjs-control-text'>Current Time</span>0:00 / <span class='vjs-control-text'>Duration</span>3:12</div></div>"
            ld = '<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"http://127.0.0.1:8765/media/hls/master.m3u8"}</script>'
            ps = ''.join(f"<p>Đoạn {i}. Danh sách đề cử Top 100 Gương mặt đẹp nhất thế giới do TC Candler bình chọn năm 2026 vừa chính thức công bố tên JIWOO. JIWOO gây ấn tượng mạnh mẽ bởi đường nét gương mặt góc cạnh.</p>" for i in range(1,5))
            return self.send(200, f"<html lang=vi><head><meta charset=utf-8><title>Kenh test</title>{ld}</head><body><article><h1>Kenh test</h1>{ps}{vid}{ps}{hls}{ps}</article></body></html>", 'text/html; charset=utf-8')
        if u.path.startswith('/img/'): return self.send(200, PNG, 'image/png')
        if u.path=='/api/tags': return self.send(200, json.dumps({'models':[{'name':'mock:1b'}]}), 'application/json')
        self.send(404, 'nope', 'text/plain')
    def do_POST(self):
        if self.path in ('/api/chat', '/v1/chat/completions'):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            msgs = body['messages']
            with open('/tmp/llm_requests.jsonl','a') as f: f.write(json.dumps(body, ensure_ascii=False)+'\n')
            sysm = msgs[0]['content'] if msgs[0]['role']=='system' else ''
            user = msgs[-1]['content']
            if 'running summary' in sysm:
                n = re.search(r'Text of page (\d+)', user).group(1)
                out = f"Summary: MOCK SUMMARY UP TO PAGE {n}.\nGlossary: river town = thị trấn ven sông"
            else:
                m = re.search(r'(?:\[Segments to translate\]|### Source Data)\n([\s\S]*)$', user)
                src = m.group(1) if m else user
                segs = re.findall(r'<s(\d+)>([\s\S]*?)</s\1>', src)
                if body['model'] == 'drop' and len(segs) > 1: segs = segs[:-1]
                if body['model'] == 'bracket':
                    out = '\n'.join(f'[s{n}>[VI] {t.upper()}' for n, t in segs)
                else:
                    out = '<think>ok</think>' + '\n'.join(f'<s{n}>[VI] {t.upper()}</s{n}>' for n, t in segs) if segs else '[VI] ' + src.upper()
            ollama = self.path == '/api/chat'
            self.send_response(200); self.send_header('Content-Type','application/x-ndjson' if ollama else 'text/event-stream'); self.end_headers()
            delay = 0.25 if body['model']=='slow' else 0.005
            for i in range(0, len(out), 25):
                piece = out[i:i+25]
                line = json.dumps({'message':{'content':piece},'done':False}) if ollama else 'data: ' + json.dumps({'choices':[{'delta':{'content':piece}}]})
                try:
                    self.wfile.write((line+'\n').encode()); self.wfile.flush()
                except Exception: return
                time.sleep(delay)
            self.wfile.write(((json.dumps({'done':True}) if ollama else 'data: [DONE]')+'\n').encode())
            return
        self.send(404,'','text/plain')
http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
