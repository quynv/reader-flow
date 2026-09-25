/* Nạp font đọc kèm theo tiện ích (Literata, Inter — đủ dấu tiếng Việt).
 * Dùng FontFace với dữ liệu nhị phân nên không bị CSP font-src của trang chặn,
 * và font thêm vào document.fonts dùng được bên trong Shadow DOM. */
globalThis.RFFonts = globalThis.RFFonts || (() => {
  const RANGES = {
    latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    vietnamese: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB'
  };
  const FAMILIES = {
    serif: { name: 'RF Literata', file: 'literata' },
    sans: { name: 'RF Inter', file: 'inter' }
  };
  const pending = {};

  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function ensure(kind) {
    const fam = FAMILIES[kind];
    if (!fam) return Promise.resolve(false);
    if (pending[kind]) return pending[kind];
    pending[kind] = (async () => {
      if ([...document.fonts].some((f) => f.family.replace(/"/g, '') === fam.name)) return true;
      const list = [];
      for (const style of ['normal', 'italic']) {
        for (const sub of Object.keys(RANGES)) list.push({ sub, style, path: `fonts/${fam.file}-${sub}-wght-${style}.woff2` });
      }
      const r = await chrome.runtime.sendMessage({ type: 'rf-fonts', paths: list.map((x) => x.path) });
      if (!r || !r.ok) throw new Error((r && r.error) || 'font load failed');
      await Promise.all(list.map(async (x, i) => {
        const face = new FontFace(fam.name, b64ToBuffer(r.data[i]), { style: x.style, weight: '100 900', unicodeRange: RANGES[x.sub], display: 'swap' });
        await face.load();
        document.fonts.add(face);
      }));
      return true;
    })().catch((e) => {
      console.warn('[Reader Flow] font:', e);
      pending[kind] = null;
      return false;
    });
    return pending[kind];
  }

  return { ensure };
})();
