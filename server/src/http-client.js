/**
 * HTTP client with optional outbound proxy support.
 *
 * Railway / datacenter IPs are often blocked by FOMO's endpoints
 * (privy.fomo.family, mobula-api.fomo.family, prod-api.fomo.family) and by
 * some CDN hosts used for logos. When a proxy URL is configured, all those
 * calls are routed through it using undici's ProxyAgent.
 *
 * Proxy sources (highest priority first):
 *   1. Runtime, set via POST /api/proxy (persisted in data/proxy.json).
 *   2. Environment: MOBULA_PROXY_URL, or PROXY_URL, or the standard HTTPS_PROXY.
 *
 * Supported scheme: http:// (also https://). Auth inline: http://user:pass@host:port
 */
import { fetch, ProxyAgent } from 'undici';
import { JsonStore } from './json-store.js';

const store = new JsonStore('proxy');

function envProxyUrl() {
  return process.env.MOBULA_PROXY_URL || process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy || '';
}

// Runtime proxy (set from the extension/app UI). Empty string = cleared.
let runtimeProxyUrl = store.get('proxy_url') || null;

/** Proxy agents per URL (undici ProxyAgent is designed to be reused). */
const agents = new Map();

function getAgent(proxyUrl) {
  if (!agents.has(proxyUrl)) agents.set(proxyUrl, new ProxyAgent(proxyUrl));
  return agents.get(proxyUrl);
}

/** Validate a proxy URL. Returns null for a clean value (clear). Throws on junk. */
export function validateProxyUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null; // explicit clear
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw Object.assign(new Error('PROXY_INVALID: proxy URL must be a valid URL (e.g. http://host:port)'), { code: 'PROXY_INVALID' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error(`PROXY_INVALID: only http:// and https:// proxies are supported (got ${parsed.protocol})`), { code: 'PROXY_INVALID' });
  }
  return raw;
}

/** Proxy currently in effect, or null. */
export function getActiveProxyUrl() {
  return (runtimeProxyUrl || envProxyUrl() || '').trim() || null;
}

/** Diagnostics for /api/config and /api/proxy. Never returns the password. */
export function proxyStatus() {
  const url = getActiveProxyUrl();
  let masked = null;
  if (url) {
    try {
      const u = new URL(url);
      u.password = '';
      masked = u.toString();
    } catch {
      masked = url;
    }
  }
  return {
    enabled: Boolean(url),
    url: masked,
    source: runtimeProxyUrl ? 'runtime' : url ? 'env' : 'none',
    runtimeUrl: runtimeProxyUrl ? masked : null,
  };
}

/** Set (or clear, with ''/null) the runtime proxy. Returns proxyStatus(). */
export function setProxyUrl(input) {
  const value = validateProxyUrl(input);
  if (value) {
    runtimeProxyUrl = value;
    store.set('proxy_url', value);
    console.log('[http-client] runtime proxy set:', proxyStatus().url);
  } else {
    runtimeProxyUrl = null;
    store.delete('proxy_url');
    console.log('[http-client] runtime proxy cleared; env fallback:', proxyStatus().source);
  }
  return proxyStatus();
}

/**
 * fetch() through the active proxy when one is configured,
 * plain global fetch otherwise.
 */
export async function proxiedFetch(url, init = {}) {
  const proxyUrl = getActiveProxyUrl();
  if (!proxyUrl) return fetch(url, init); // Node's global fetch (no proxy)
  return fetch(url, { ...init, dispatcher: getAgent(proxyUrl) });
}
