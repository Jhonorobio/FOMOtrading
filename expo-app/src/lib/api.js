// REST client for the paper-terminal server (server/src/index.js).
// Default: the Railway production deployment; overridable in Settings.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { makeClientRequestId } from './format';

export const SERVER_URL_KEY = 'serverUrl';
export const TOKEN_KEY = 'sessionToken';

export const DEFAULT_SERVER_URL = 'https://paper-terminal-production.up.railway.app';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let serverUrlCache = DEFAULT_SERVER_URL;
let tokenCache = null;

export function getServerUrl() {
  return serverUrlCache;
}

export async function bootApi() {
  const [storedUrl, storedToken] = await Promise.all([
    AsyncStorage.getItem(SERVER_URL_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
  ]);
  if (storedUrl && /^https?:\/\//.test(storedUrl.trim())) serverUrlCache = storedUrl.trim();
  tokenCache = storedToken || null;
}

export async function setServerUrl(url) {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//.test(clean)) throw new Error('URL must start with http:// or https://');
  serverUrlCache = clean.replace(/\/+$/, '');
  await AsyncStorage.setItem(SERVER_URL_KEY, serverUrlCache);
}

export const hasToken = () => !!tokenCache;

export async function saveToken(token) {
  tokenCache = token || null;
  if (!token) await SecureStore.deleteItemAsync(TOKEN_KEY);
  else await SecureStore.setItemAsync(TOKEN_KEY, token);
}

async function request(path, { method = 'GET', body, anonymous = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (!anonymous && tokenCache) headers.Authorization = `Bearer ${tokenCache}`;
  let res;
  try {
    res = await fetch(`${serverUrlCache}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'NETWORK', `Paper server offline (${e?.message || 'network error'})`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = data && data.error ? data.error : {};
    throw new ApiError(res.status, err.code || 'ERROR', err.message || `Error ${res.status}`);
  }
  return data;
}

// ---- auth ----
export async function signInWithCode(code) {
  const d = await request('/api/auth/code', { method: 'POST', body: { code }, anonymous: true });
  await saveToken(d.sessionToken);
  return d.user;
}

export async function signOut() {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } catch {}
  await saveToken(null);
}

// ---- public ----
export const api = {
  health: () => request('/api/health', { anonymous: true }),
  config: () => request('/api/config', { anonymous: true }),
  quote: (chain, address) =>
    request(`/api/quote?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`, { anonymous: true }),
  tokenLogo: (chain, address) =>
    request(`/api/token-logo?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`, { anonymous: true }),
  tokens: () => request('/api/tokens', { anonymous: true }),

  me: () => request('/api/me'),
  assetState: (chain, address) =>
    request(`/api/asset-state?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`),
  portfolio: (tzOffsetMinutes = 0) => request(`/api/portfolio?tzOffset=${tzOffsetMinutes}`),
  trades: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]));
    const q = qs.toString();
    return request(`/api/trades${q ? `?${q}` : ''}`);
  },
  closedTrades: () => request('/api/closed-trades'),
  placeTrade: ({ chain, address, side, amountUsd, percent }) =>
    request('/api/trades', {
      method: 'POST',
      body: {
        chain,
        address,
        side,
        clientRequestId: makeClientRequestId(),
        ...(amountUsd != null ? { amountUsd } : null),
        ...(percent != null ? { percent } : null),
      },
    }),
  closePosition: (chain, address) =>
    request('/api/positions/close', { method: 'POST', body: { chain, address, clientRequestId: makeClientRequestId() } }),
  accountStart: (startingBalance) => request('/api/account/start', { method: 'POST', body: { startingBalance } }),
  accountReset: (startingBalance) => request('/api/account/reset', { method: 'POST', body: { startingBalance } }),
  accountDelete: () => request('/api/account/delete', { method: 'POST' }),
  saveProfile: (displayName) => request('/api/profile', { method: 'POST', body: { displayName } }),
  consent: () => request('/api/consent', { method: 'POST', body: {} }),
  exportText: async (format) => {
    const res = await fetch(`${serverUrlCache}/api/export?format=${format}`, {
      headers: tokenCache ? { Authorization: `Bearer ${tokenCache}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, 'EXPORT', 'Export failed');
    return res.text();
  },
};
