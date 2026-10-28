// Background worker: owns the session token, Google OAuth and every call to the paper-trading server.
// It never talks to FOMO's trading endpoints and never touches wallets or keys.
import { getSettings, updateSettings } from '../storage/settings.js';

// The toolbar icon opens the popup; the popup (and the overlay) open the side panel.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  // First install: open the welcome page (sign in -> choose starting capital).
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/sidepanel.html?welcome=1') });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'open-side-panel' && tab?.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId });
  if (command === 'toggle-paper-mode') {
    const { overlayEnabled } = await getSettings();
    await updateSettings({ overlayEnabled: !overlayEnabled });
  }
});

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

async function getSession() {
  const { session } = await chrome.storage.local.get('session');
  return session || null;
}

async function request(method, path, body, { raw = false } = {}) {
  const { serverUrl } = await getSettings();
  const session = await getSession();
  let res;
  try {
    res = await fetch(serverUrl.replace(/\/+$/, '') + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'SERVER_UNREACHABLE', `Can't reach the paper-trading server at ${serverUrl}. Is it running?`);
  }

  if (raw && res.ok) {
    const disposition = res.headers.get('Content-Disposition') || '';
    return {
      text: await res.text(),
      contentType: res.headers.get('Content-Type') || 'application/octet-stream',
      filename: /filename="([^"]+)"/.exec(disposition)?.[1] || 'export',
    };
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error || {};
    // Only drop the session this request actually used; a newer sign-in must survive a stale 401.
    if (res.status === 401 && session) {
      const { session: current } = await chrome.storage.local.get('session');
      if (current?.token === session.token) await chrome.storage.local.remove('session');
    }
    throw new ApiError(res.status, err.code || 'HTTP_ERROR', err.message || `Request failed (${res.status}).`, err.details);
  }
  return data;
}

async function bumpPortfolioVersion() {
  await chrome.storage.local.set({ portfolioVersion: Date.now() });
}

/** One sign-in flow at a time. */
let signInCode = null;

function signInWithCode({ code }) {
  signInCode ??= runSignInWithCode(code).finally(() => (signInCode = null));
  return signInCode;
}

async function runSignInWithCode(code) {
  const { sessionToken, user } = await request('POST', '/api/auth/code', { code });
  await chrome.storage.local.set({ session: { token: sessionToken, user } });
  await bumpPortfolioVersion();
  return { user };
}

async function signOut() {
  try {
    await request('POST', '/api/auth/logout');
  } catch {
    // signing out locally is enough
  }
  await chrome.storage.local.remove('session');
  return { ok: true };
}

// Only these paths may be called through the generic API bridge.
const ALLOWED = [
  ['GET', /^\/api\/(config|health|me|portfolio|quote|token-logo|price-history|asset-state|trades|closed-trades)(\?|$)/],
  ['POST', /^\/api\/(trades|positions\/close|account\/start|account\/reset|account\/delete|profile|consent)$/],
];
const MUTATIONS = /^\/api\/(trades|positions\/close|account\/start|account\/reset|account\/delete)$/;

async function handle(message, sender) {
  switch (message?.type) {
    case 'api': {
      const { method, path, body } = message;
      if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) throw new ApiError(400, 'BAD_REQUEST', 'Unsupported request.');
      const data = await request(method, path, body);
      // Deleting the account kills the session with it; drop it here so the UI signs out cleanly.
      if (path === '/api/account/delete') await chrome.storage.local.remove('session');
      // Keep the stored session in step, so every surface picks up a new username or picture.
      if (path === '/api/profile' && data?.user) {
        const { session } = await chrome.storage.local.get('session');
        if (session) await chrome.storage.local.set({ session: { ...session, user: data.user } });
      }
      if (method === 'POST' && MUTATIONS.test(path)) await bumpPortfolioVersion();
      return data;
    }
    case 'export':
      return request('GET', `/api/export?format=${message.format === 'csv' ? 'csv' : 'json'}`, null, { raw: true });
    case 'auth:code':
      return signInWithCode(message);
    case 'auth:signout':
      return signOut();
    case 'open-sidepanel':
      if (sender.tab?.windowId !== undefined) await chrome.sidePanel.open({ windowId: sender.tab.windowId });
      return { ok: true };
    default:
      throw new ApiError(400, 'BAD_REQUEST', 'Unknown message.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(message, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (err) => sendResponse({ ok: false, error: { status: err.status ?? 0, code: err.code || 'ERROR', message: err.message, details: err.details } }),
  );
  return true;
});
