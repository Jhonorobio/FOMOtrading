/**
 * Telemetry.io authentication — direct access token.
 *
 * Uses a Bearer token from app.telemetry.io dashboard.
 * When it expires (401), invalidate it and set a new one via
 * POST /api/market/telemetry/token without restarting the server.
 */
import { JsonStore } from '../json-store.js';

const store = new JsonStore('telemetry-auth');

let accessToken = null;
let accessExpMs = 0;

/** Direct access token from env var. */
export function getDirectAccessToken() {
  return process.env.TELEMETRY_ACCESS_TOKEN || null;
}

export function hasCredentials() {
  return Boolean(process.env.TELEMETRY_ACCESS_TOKEN || accessToken);
}

/**
 * Returns the current access token.
 * No auto-refresh: when it expires, the caller sets a new one via the API endpoint.
 */
export function getAccessToken({ force = false } = {}) {
  if (!force && accessToken) {
    return Promise.resolve(accessToken);
  }
  const direct = process.env.TELEMETRY_ACCESS_TOKEN;
  if (direct) {
    accessToken = direct;
    accessExpMs = Date.now() + 86_400_000; // treat as valid for 24h
    return Promise.resolve(accessToken);
  }
  return Promise.reject(new Error('TELEMETRY: no access token configured (TELEMETRY_ACCESS_TOKEN)'));
}

/** Drop the cached token — next call re-reads from env. */
export function invalidateAccessToken() {
  accessToken = null;
  accessExpMs = 0;
}

/** Save a direct access token (called by the API endpoint). */
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
    mode: 'direct',
  };
}
