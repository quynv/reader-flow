# Reader Flow — dev harness

Kept next to (not inside) `../reader-flow`, because Chrome refuses to load an extension folder that contains names starting with `_` (e.g. inside `node_modules/`).

```bash
npm install                     # jsdom + video.js / MediaElement used by the fixtures
npm run unit                    # jsdom unit tests
python3 i18n/build.py           # regenerate ../reader-flow/_locales from i18n/messages.py
python3 server/server.py &      # fixtures + mock LLM at http://127.0.0.1:8765
pip install playwright && cd e2e && python3 e2e.py   # e2e with the real extension in Chromium
```

See `../HANDOFF.md` for architecture, conventions and the list of tests.
