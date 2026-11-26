/**
 * Telemetry.io authentication — automatic refresh token rotation.
 *
 * Uses cookie-based refresh: POST /v1/auth/refresh with the refresh_token cookie.
 * The server responds with new cookies: refresh_token, auth_token, data_access_token.
 * We extract data_access_token from the Set-Cookie headers for API calls.
 *
 * Credentials live in server/data/telemetry-auth.json (gitignored) or the
 * TELEMETRY_REFRESH_TOKEN env var.
 */
import { JsonStore } from '../json-store.js';

const REFRESH_URL = 'https://app.telemetry.io/v1/auth/refresh';
const REFRESH_TIMEOUT_MS = 15_000;
const MIN_REMAINING_MS = 120_000;

const store = new JsonStore('telemetry-auth');

let accessToken = null; // data_access_token for price API calls
let refreshToken = null; // stored refresh token
let accessExpMs = 0;
let inflight = null;
// Backoff state for rate-limited (429) responses from telemetry.io
let backoffUntil = 0;
const BACKOFF_DEFAULT_MS = 60_000; // 1 minute default backoff on 429

function decodeExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return Number(payload.exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

/** Parse Set-Cookie header(s) into a cookie map. */
function parseSetCookie(setCookieHeader) {
  const cookies = {};
  if (!setCookieHeader) return cookies;

  // If it's an array (from getSetCookie()), process each entry
  const entries = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader];

  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq === -1) continue;
    const name = entry.slice(0, eq).trim();
    const value = entry.slice(eq + 1).split(';')[0].trim();
    cookies[name] = value;
  }
  return cookies;
}

/** Refresh token from env or local data file.
 *  After the first successful refresh, the rotated token (stored in memory/file)
 *  takes precedence over the (possibly stale) env var. */
export function getRefreshToken() {
  if (refreshToken) return refreshToken;
  return process.env.TELEMETRY_REFRESH_TOKEN || store.get('refresh_token') || null;
}

/** Direct access token from env (TELEMETRY_ACCESS_TOKEN). */
export function getDirectAccessToken() {
  return process.env.TELEMETRY_ACCESS_TOKEN || null;
}

export function hasCredentials() {
  return Boolean(getRefreshToken() || accessToken);
}

/**
 * Returns a valid data_access_token for price API calls.
 * Auto-refreshes via /v1/auth/refresh when needed.
 * Single-flight: concurrent callers share one in-flight renewal.
 */
export function getAccessToken({ force = false } = {}) {
  // During backoff, return cached token if available (even if expired) to avoid hammering
  if (Date.now() < backoffUntil) {
    if (accessToken) return Promise.resolve(accessToken);
    return Promise.reject(new Error('TELEMETRY: rate limited (429), backing off'));
  }

  if (!force && accessToken && Date.now() < accessExpMs - MIN_REMAINING_MS) {
    return Promise.resolve(accessToken);
  }
  if (inflight) return inflight;

  const rt = getRefreshToken();
  if (!rt) {
    return Promise.reject(new Error('TELEMETRY: no refresh token (data/telemetry-auth.json or TELEMETRY_REFRESH_TOKEN)'));
  }

  inflight = (async () => {
    try {
      const res = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          Cookie: `refresh_token=${rt}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (!res.ok) {
        if (res.status === 429) {
          // Rate limited: set backoff and try to use Retry-After header
          const retryAfter = res.headers.get('retry-after');
          const waitMs = retryAfter
            ? (isNaN(retryAfter) ? 0 : Number(retryAfter) * 1000)
            : BACKOFF_DEFAULT_MS;
          backoffUntil = Date.now() + (waitMs > 0 ? waitMs : BACKOFF_DEFAULT_MS);
          console.warn(`[telemetry-auth] 429 rate limited on refresh, backing off for ${Math.round((backoffUntil - Date.now()) / 1000)}s`);
          // Return cached token if available (even expired) as fallback
          if (accessToken) return accessToken;
          throw new Error('TELEMETRY_ERROR:429');
        }
        if (res.status === 401 || res.status === 403) {
          // Invalid/expired refresh token: don't retry, clear state
          console.error(`[telemetry-auth] Refresh token invalid/expired (HTTP ${res.status}). Update TELEMETRY_REFRESH_TOKEN or use POST /api/market/telemetry/token`);
          backoffUntil = Date.now() + BACKOFF_DEFAULT_MS;
          throw new Error('TELEMETRY_ERROR:401');
        }
        throw new Error(`TELEMETRY refresh failed: HTTP ${res.status}`);
      }

      const setCookies = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') || res.headers.get('Set-Cookie'));
      const cookies = parseSetCookie(setCookies);

      const newAccessToken = cookies['data_access_token'] || cookies['auth_token'];
      const newRefreshToken = cookies['refresh_token'];

      if (!newAccessToken) {
        throw new Error('TELEMETRY refresh: no data_access_token in response cookies');
      }

      accessToken = newAccessToken;
      accessExpMs = decodeExp(newAccessToken) || Date.now() + 3_600_000;

      if (newRefreshToken && newRefreshToken !== rt) {
        store.set('refresh_token', newRefreshToken);
        store.set('updated_at', new Date().toISOString());
        refreshToken = newRefreshToken;
      } else {
        refreshToken = rt;
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
  refreshToken = token;
  invalidateAccessToken();
}

/** Save a direct access token (used as-is, no refresh). */
export function setDirectAccessToken(token) {
  accessToken = token;
  accessExpMs = Date.now() + 86_400_000;
}

// Initialize direct access token from env on module load
const _directToken = process.env.TELEMETRY_ACCESS_TOKEN;
if (_directToken) {
  accessToken = _directToken;
  accessExpMs = Date.now() + 86_400_000; // 24h
  console.log('[telemetry-auth] Loaded TELEMETRY_ACCESS_TOKEN from env');
}

/** Diagnostics for GET /api/market/telemetry/status. Never exposes the token. */
export function telemetryAuthStatus() {
  return {
    hasRefreshToken: hasCredentials(),
    hasCachedToken: Boolean(accessToken),
    tokenExpiresAt: accessExpMs || null,
    tokenExpiresInSeconds: accessExpMs ? Math.max(0, Math.round((accessExpMs - Date.now()) / 1000)) : null,
    mode: accessToken ? (process.env.TELEMETRY_REFRESH_TOKEN ? 'refresh' : 'direct') : 'none',
  };
}
