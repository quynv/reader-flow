/* Reader Flow — cài đặt dùng chung cho content script, background và trang tuỳ chọn. */
var RF_DEFAULTS = {
  uiLang: 'auto',          // auto | en | vi | ja

  // Nối trang
  maxPages: 10,            // tối đa bao nhiêu trang được hiển thị (tính cả trang đầu)
  prefetchAhead: 1,        // đang đọc trang N thì tải sẵn tới trang N + prefetchAhead
  jsRenderFallback: true,  // trang tải về quá ít chữ -> mở tab nền để JS render rồi lấy lại
  renderWaitMs: 1500,
  minTextLength: 200,

  // Hiển thị
  theme: 'auto',           // auto | light | sepia | dark
  fontFamily: 'serif',     // serif (Literata) | sans (Inter) | system-serif | system-sans
  fontSize: 19,
  lineWidth: 700,
  lineHeight: 1.7,
  keepMedia: true,

  // Dịch bằng LLM chạy local
  trProvider: 'ollama',    // ollama | openai (LM Studio, llama.cpp server, vLLM, Jan...)
  trEndpoint: 'http://localhost:11434',
  trModel: 'qwen2.5:7b',
  trApiKey: '',
  trTargetLang: '',        // trống = theo ngôn ngữ giao diện
  trDisplay: 'bilingual',  // bilingual | replace (chỉ hiện bản dịch)
  trAuto: false,           // tự dịch khi mở chế độ đọc
  trConcurrency: 2,
  trTemperature: 0.2,
  trNoThink: true,
  trUnit: 'page',          // page = dịch cả trang một lần | paragraph = từng đoạn
  trChunkChars: 4000,      // trang dài hơn sẽ được cắt thành nhiều phần liên tiếp
  trUseSummary: true,      // đưa tóm tắt các trang trước vào ngữ cảnh
  trSummaryModel: '',      // trống = dùng mô hình dịch
  trProfile: 'auto',       // auto | generic | hymt | tgemma
  trNumCtx: 16384,         // num_ctx cho Ollama

  // Đọc to bằng giọng của trình duyệt
  ttsSource: 'auto',       // auto (đọc bản dịch khi đang bật dịch) | original | translation
  ttsRate: 1,
  ttsAutoScroll: true,
  ttsVoices: {},           // { vi: voiceURI, ja: voiceURI, ... } — trống = tự chọn

  // Quy tắc riêng theo tên miền: { "example.com": { nextSelector, nextText, contentSelector } }
  siteRules: {}
};

async function rfLoadSettings() {
  const stored = await chrome.storage.local.get(null);
  const s = Object.assign({}, RF_DEFAULTS, stored);
  // Chuyển từ bản cũ (menu 3 chế độ) — chỉ làm MỘT lần: ghi giá trị mới rồi xoá khoá cũ,
  // để lựa chọn của người dùng sau đó không bị ghi đè mỗi lần tải cài đặt.
  if (stored.trMode !== undefined) {
    const patch = {};
    if (stored.trDisplay === undefined && (stored.trMode === 'replace' || stored.trMode === 'bilingual')) patch.trDisplay = stored.trMode;
    if (stored.trAuto === undefined) patch.trAuto = stored.trMode !== 'off';
    Object.assign(s, patch);
    delete s.trMode;
    try {
      if (Object.keys(patch).length) await chrome.storage.local.set(patch);
      await chrome.storage.local.remove('trMode');
    } catch (e) { /* bỏ qua */ }
  }
  if (!s.trTargetLang && typeof rfResolveLang === 'function') s.trTargetLang = RF_LOCALE_TARGET[rfResolveLang(s.uiLang)] || 'English';
  return s;
}

async function rfSaveSettings(patch) {
  await chrome.storage.local.set(patch);
}
