/**
 * Cliente de API para la app Expo Paper Terminal.
 * Toda la tráfico va contra el servidor Node.js/Express (puerto 3001 por defecto).
 * Configura SERVER_URL en un archivo .env o cambia DEFAULT_SERVER_URL.
 */
import { Platform } from 'react-native';

const DEFAULT_SERVER_URL = Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';

let serverUrl = DEFAULT_SERVER_URL;

export function setServerUrl(url) {
  serverUrl = url.replace(/\/+$/, '');
}

export function getServerUrl() {
  return serverUrl;
}

class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, body, options = {}) {
  const url = `${serverUrl}${path}`;
  const headers = {
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError({ status: 0, code: 'SERVER_UNREACHABLE', message: `No se puede alcanzar el servidor en ${serverUrl}. ¿Está ejecutándose?` });
  }

  if (options.raw && res.ok) {
    const disposition = res.headers.get('Content-Disposition') || '';
    const filenameMatch = /filename="([^"]+)"/.exec(disposition);
    return {
      text: await res.text(),
      contentType: res.headers.get('Content-Type') || 'application/octet-stream',
      filename: filenameMatch ? filenameMatch[1] : 'export',
    };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = data?.error || {};
    throw new ApiError({
      status: res.status,
      code: err.code || 'HTTP_ERROR',
      message: err.message || `Request failed (${res.status})`,
      details: err.details,
    });
  }

  return data;
}

const qs = (params) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  return s ? `?${s}` : '';
};

export const api = {
  config: () => request('GET', '/api/config'),
  tokens: () => request('GET', '/api/tokens'),
  me: () => request('GET', '/api/me'),
  quote: (chain, address) => request('GET', `/api/quote${qs({ chain, address })}`),
  tokenLogo: (chain, address) => request('GET', `/api/token-logo${qs({ chain, address })}`),
  assetState: (chain, address) => request('GET', `/api/asset-state${qs({ chain, address })}`),
  portfolio: () => request('GET', '/api/portfolio'),
  trades: (filters = {}) => request('GET', `/api/trades${qs(filters)}`),
  closedTrades: () => request('GET', '/api/closed-trades'),
  trade: (body) => request('POST', '/api/trades', body),
  closePosition: (body) => request('POST', '/api/positions/close', body),
  startAccount: (startingBalance) => request('POST', '/api/account/start', { startingBalance }),
  resetAccount: (startingBalance) => request('POST', '/api/account/reset', { startingBalance }),
  export: (format = 'json') => request('GET', `/api/export?format=${format}`, null, { raw: true }),
  signInWithCode: (code) => request('POST', '/api/auth/code', { code }),
  signOut: () => request('POST', '/api/auth/logout'),
  updateProfile: (body) => request('POST', '/api/profile', body),
  consent: () => request('POST', '/api/consent', {}),
};
