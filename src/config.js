// Extension-side defaults. Paper account economics (starting balance, fees) live on the server.
// For local development set devServerUrl in chrome.storage.local (e.g. 'http://localhost:3001').
// For production deploy (Railway), change this to your Railway URL.
export const DEFAULT_SERVER_URL = 'http://localhost:3001';

// Accounts that see admin-only surfaces (the Real P&L card). UI gating only - see admin.js.
export const ADMIN_EMAILS = ['mateeur9944@gmail.com'];

export const DEFAULT_BUY_PRESETS = [10, 100, 500, 1000];
export const DEFAULT_SELL_PRESETS = [25, 50, 75, 100];

export const QUOTE_REFRESH_MS = 200;
export const PORTFOLIO_REFRESH_MS = 200;
export const PRICE_STALE_MS = 30000;

export const TARGET_TERMINAL = {
  name: 'FOMO',
  origin: 'https://fomo.family',
};
