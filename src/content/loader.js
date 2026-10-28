// Content scripts can't be ES modules directly; load the module graph dynamically.
(() => {
  if (window.__paperTerminalLoaded) return;
  window.__paperTerminalLoaded = true;
  import(chrome.runtime.getURL('src/content/main.js'))
    .then((m) => m.start())
    .catch((err) => console.error('[Paper Terminal] failed to start', err));
})();
