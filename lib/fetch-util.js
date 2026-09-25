/* Tải HTML và giải mã đúng bảng mã (UTF-8, Shift_JIS, EUC-JP, GBK, windows-1258...). */
function rfDecodeHtml(buffer, contentType) {
  const bytes = new Uint8Array(buffer);
  let charset = null;

  // BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) charset = 'utf-8';
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) charset = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) charset = 'utf-16be';

  if (!charset) {
    const m = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType || '');
    if (m) charset = m[1];
  }
  if (!charset) {
    // Dò thẻ <meta charset> trong 8KB đầu (đọc như latin1 là đủ cho ASCII)
    const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 8192));
    const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
    if (m) charset = m[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch (e) {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function rfFetchHtml(url) {
  const res = await fetch(url, { credentials: 'include', redirect: 'follow', cache: 'default' });
  if (!res.ok) throw new Error(rfT('errHttp', res.status));
  const ct = res.headers.get('content-type') || '';
  if (ct && !/html|xml|text\/plain/i.test(ct)) throw new Error(rfT('errNotHtml', ct.split(';')[0]));
  const buf = await res.arrayBuffer();
  return { html: rfDecodeHtml(buf, ct), finalUrl: res.url || url };
}
