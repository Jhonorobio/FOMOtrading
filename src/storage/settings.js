import { DEFAULT_BUY_PRESETS, DEFAULT_SELL_PRESETS, DEFAULT_SERVER_URL } from '../config.js';

const DEFAULTS = {
  serverUrl: DEFAULT_SERVER_URL,
  overlayEnabled: true,
  buyPresets: DEFAULT_BUY_PRESETS,
  sellPresets: DEFAULT_SELL_PRESETS,
  hideDust: true,
  discreetOverlay: false, // hide the paper wording on the FOMO panel (it still only ever simulates)
  priceDisplay: 'price', // 'price' (USD per token) | 'mcap' (market cap)
  supportCollapsed: false, // the Support card at the foot of the Trade tab, folded to one line
};

/**
 * False once the extension has been reloaded or updated while an old content script is still
 * running in a tab. Every chrome.* call from that orphaned script throws "Extension context invalidated".
 */
export function extensionAlive() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export async function getSettings() {
  if (!extensionAlive()) return { ...DEFAULTS };
  try {
    const { settings } = await chrome.storage.local.get('settings');
    return withServerUrl({ ...DEFAULTS, ...(settings || {}) });
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * The server address comes from the build, never from anything a user can type: pointing the
 * extension at someone else's server would hand them your sign-in. Local development sets
 * `devServerUrl` by hand (chrome.storage.local), which nothing in the UI writes.
 */
function withServerUrl(settings) {
  const dev = typeof settings.devServerUrl === 'string' && /^https?:\/\/\S+$/.test(settings.devServerUrl) ? settings.devServerUrl : null;
  return { ...settings, serverUrl: (dev || DEFAULT_SERVER_URL).replace(/\/+$/, '') };
}

export async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  if (!extensionAlive()) return next;
  try {
    await chrome.storage.local.set({ settings: next });
  } catch {
    // extension was reloaded mid-call; the new instance owns settings now
  }
  return next;
}

/** Public session info only (user profile). The token itself is read by the background worker. */
export async function getSessionUser() {
  if (!extensionAlive()) return null;
  try {
    const { session } = await chrome.storage.local.get('session');
    return session?.user || null;
  } catch {
    return null;
  }
}

/** Fires cb(changes) for settings, session and portfolio-version changes. Returns an unsubscribe fn. */
export function onStateChange(cb) {
  const listener = (changes, area) => {
    if (area !== 'local') return;
    if (changes.settings || changes.session || changes.portfolioVersion) cb(changes);
  };
  if (!extensionAlive()) return () => {};
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      // already detached when the extension context went away
    }
  };
}
