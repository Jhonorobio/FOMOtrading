/**
 * Telemetry.io authentication — automatic refresh token rotation OR direct access token.
 *
 * Supports two modes:
 * 1. Refresh token: POST https://app.telemetry.io/v1/auth/refresh with { refresh_token }
 *    → returns new access_token. Credentials in server/data/telemetry-auth.json or
 *    TELEMETRY_REFRESH_TOKEN env var.
 * 2. Direct access token: TELEMETRY_ACCESS_TOKEN env var — used as-is as the Bearer
 *    token, no refresh needed (good for short-lived session tokens).
 */
import { JsonStore } from '../json-store.js';

const REFRESH_URL = 'https://app.telemetry.io/v1/auth/refresh';
const REFRESH_TIMEOUT_MS = 15_000;
const MIN_REMAINING_MS = 120_000;

const store = new JsonStore('telemetry-auth');

let accessToken = null;
let accessExpMs = 0;
let inflight = null;

function decodeExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return Number(payload.exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

/** Refresh token from env or local data file. */
export function getRefreshToken() {
  return process.env.TELEMETRY_REFRESH_TOKEN || store.get('refresh_token') || null;
}

/** Direct access token from env (no refresh). */
export function getDirectAccessToken() {
  return process.env.TELEMETRY_ACCESS_TOKEN || null;
}

export function hasCredentials() {
  return Boolean(getRefreshToken() || getDirectAccessToken());
}

/**
 * Returns a valid access token. Prefers direct token if set; otherwise refreshes.
 * Single-flight: concurrent callers share one in-flight refresh.
 */
export function getAccessToken({ force = false } = {}) {
  // Direct token mode: no refresh needed.
  const direct = getDirectAccessToken();
  if (direct) {
    if (!force && accessToken === direct && Date.now() < accessExpMs - MIN_REMAINING_MS) {
      return Promise.resolve(accessToken);
    }
    accessToken = direct;
    accessExpMs = Date.now() + 86_400_000; // treat as valid for 24h
    return Promise.resolve(accessToken);
  }

  // Refresh token mode.
  if (!force && accessToken && Date.now() < accessExpMs - MIN_REMAINING_MS) {
    return Promise.resolve(accessToken);
  }
  if (inflight) return inflight;

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return Promise.reject(new Error('TELEMETRY: no token configured (TELEMETRY_ACCESS_TOKEN or TELEMETRY_REFRESH_TOKEN)'));
  }

  inflight = (async () => {
    try {
      const res = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.access_token) {
        throw new Error(`TELEMETRY refresh failed: HTTP ${res.status} ${body?.error || body?.code || ''}`.trim());
      }
      accessToken = body.access_token;
      accessExpMs = decodeExp(body.access_token) || Date.now() + 3_600_000;
      if (typeof body.refresh_token === 'string' && body.refresh_token && body.refresh_token !== refreshToken) {
        store.set('refresh_token', body.refresh_token);
        store.set('updated_at', new Date().toISOString());
      }
      return accessToken;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Drop the cached token — next call force-mints (used after auth failures). */
export function invalidateAccessToken() {
  accessToken = null;
  accessExpMs = 0;
}

/** Save a refresh token (e.g. seeded manually into a deployment). */
export function setRefreshToken(token) {
  store.set('refresh_token', token);
  store.set('updated_at', new Date().toISOString());
  invalidateAccessToken();
}

/** Save a direct access token. */
export function setDirectAccessToken(token) {
  accessToken = token;
  accessExpMs = Date.now() + 86_400_000;
}

/** Diagnostics for GET /api/market/telemetry/status. Never exposes the token. */
export function telemetryAuthStatus() {
  return {
    hasRefreshToken: hasCredentials(),
    hasCachedToken: Boolean(accessToken),
    tokenExpiresAt: accessExpMs || null,
    tokenExpiresInSeconds: accessExpMs ? Math.max(0, Math.round((accessExpMs - Date.now()) / 1000)) : null,
    mode: getDirectAccessToken() ? 'direct' : getRefreshToken() ? 'refresh' : 'none',
  };
}
