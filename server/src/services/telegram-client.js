/**
 * Telegram Client (MTProto) — captures messages from channels the user is subscribed to.
 *
 * Uses teleproto (maintained fork of GramJS) to connect as a real user account.
 * Requires TELEGRAM_API_ID and TELEGRAM_API_HASH from https://my.telegram.org
 * Authentication: phone number + OTP code (first run), then session is persisted.
 *
 * Environment variables:
 *   TELEGRAM_API_ID       - from my.telegram.org (required)
 *   TELEGRAM_API_HASH     - from my.telegram.org (required)
 *   TELEGRAM_PHONE        - phone number with country code, e.g. +54911... (required for first auth)
 *   TELEGRAM_SESSION      - session string (after first auth, stored in data/telegram-session.txt)
 *   TELEGRAM_2FA_PASSWORD - 2FA password if account has it (optional)
 *   TELEGRAM_CHANNELS     - comma-separated channel usernames/IDs to monitor (optional, empty = all)
 */
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { NewMessage } from 'teleproto/events';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { saveTelegramMessage, saveDetectedToken, updateDetectedTokenAxiom, updateDetectedTokenFomo, updateDetectedTokenKol, updateDetectedTokenCommunity, updateDetectedTokenPump, updateDetectedTokenAxiomTraders, isTelegramTokenNotified, markTelegramTokenNotified } from '../db.js';
import { fetchQuote } from '../market-data.js';
import { sendTelegramMessage, formatMarketCap } from '../telegram.js';

const DATA_DIR = join(process.cwd(), 'data');
const SESSION_PATH = join(DATA_DIR, 'telegram-session.txt');

let client = null;
let connected = false;
let connecting = false;
let lastError = null;
let messageCount = 0;

// Channels to monitor (empty = all)
let monitoredChannels = [];

function loadSession() {
  // Priority: env var > file
  if (process.env.TELEGRAM_SESSION) return process.env.TELEGRAM_SESSION;
  if (existsSync(SESSION_PATH)) {
    try {
      return readFileSync(SESSION_PATH, 'utf8').trim();
    } catch {
      return '';
    }
  }
  return '';
}

function saveSession(sessionStr) {
  try {
    writeFileSync(SESSION_PATH, sessionStr, 'utf8');
    console.log('[telegram-client] Session saved to', SESSION_PATH);
  } catch (err) {
    console.error('[telegram-client] Failed to save session:', err.message);
  }
}

function parseChannels() {
  const raw = process.env.TELEGRAM_CHANNELS || '';
  if (!raw.trim()) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Extract token age in minutes from message text.
 * Looks for patterns like "Age: 42m", "Age: 2h", "Age: 1d", "Age: 30 min", etc.
 * Returns null if no age found.
 */
function extractAgeMinutes(text) {
  if (!text) return null;
  // Strip markdown formatting and join split lines
  let clean = text.replace(/\*{1,2}|_{1,2}|`/g, '');
  clean = clean.replace(/([1-9A-HJ-NP-Za-km-z])\n([1-9A-HJ-NP-Za-km-z])/g, '$1$2');
  // Match "Age:" followed by number + unit
  const ageRegex = /age[:\s]*(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?)\b/i;
  const match = clean.match(ageRegex);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('m')) return value;
  if (unit.startsWith('h')) return value * 60;
  if (unit.startsWith('d')) return value * 1440;
  return null;
}

/**
 * Extract Solana contract addresses from text.
 * Solana addresses are base58 encoded, 32-44 characters.
 * Also detects pump.fun URLs and common CA patterns.
 */
function extractSolanaAddresses(text) {
  if (!text) return [];
  const found = new Set();

  // Strip markdown formatting (*, **, _, __, backticks) to handle wrapped addresses
  let clean = text.replace(/\*{1,2}|_{1,2}|`/g, '');
  // Join lines that might split an address: remove newlines between base58 chars
  clean = clean.replace(/([1-9A-HJ-NP-Za-km-z])\n([1-9A-HJ-NP-Za-km-z])/g, '$1$2');

  // Pattern 1: pump.fun URLs
  const pumpRegex = /pump\.fun\/([1-9A-HJ-NP-Za-km-z]{32,44})/g;
  let m;
  while ((m = pumpRegex.exec(clean)) !== null) {
    found.add(m[1]);
  }

  // Pattern 2: "CA:", "Contract:", "Token:", "Address:" followed by address
  const caRegex = /(?:CA|Contract|Token|Address|ca|contract|token|address)[:\s]+([1-9A-HJ-NP-Za-km-z]{32,44})/g;
  while ((m = caRegex.exec(clean)) !== null) {
    found.add(m[1]);
  }

  // Pattern 3: standalone base58 addresses (32-44 chars) on their own line or surrounded by spaces/newlines
  const standaloneRegex = /(?:^|\s|\n)([1-9A-HJ-NP-Za-km-z]{32,44})(?:\s|\n|$)/g;
  while ((m = standaloneRegex.exec(clean)) !== null) {
    found.add(m[1]);
  }

  // Filter out known non-address strings (common base58 words that are too short or too long)
  const filtered = [...found].filter((addr) => {
    // Must be valid base58 (no 0, O, I, l)
    if (/[0OIl]/.test(addr)) return false;
    // Must be between 32 and 44 chars
    if (addr.length < 32 || addr.length > 44) return false;
    return true;
  });

  return filtered;
}

/**
 * Fetch Axiom callout count from GMGN API.
 * Returns { count, callers } or null on failure.
 */
// CycleTLS instance for GMGN (Cloudflare-protected)
let gmgnCycleTLS = null;
async function getGmgnCycleTLS() {
  if (!gmgnCycleTLS) {
    const initCycleTLS = (await import('cycletls')).default;
    gmgnCycleTLS = await initCycleTLS();
  }
  return gmgnCycleTLS;
}

async function fetchAxiomCallouts(address) {
  try {
    const client = await getGmgnCycleTLS();
    const url = `https://gmgn.ai/vas/api/v1/callout/token?chain=sol&token=${address}&platforms=axiom&limit=100`;
    const resp = await client(url, {
      client: 'chrome131',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://gmgn.ai/',
        'Origin': 'https://gmgn.ai',
      },
    }, 'GET');
    if (resp.status !== 200) return null;

    // CycleTLS may return parsed object or raw bytes
    let data;
    const raw = resp.data;
    if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) {
      data = raw;
    } else {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? '');
      data = JSON.parse(text);
    }

    if (data.code !== 0 || !data.data?.list) return null;
    const list = data.data.list;
    const callers = list.map((c) => ({
      name: c.author?.name || c.author?.handle || (c.author?.id ? c.author.id.slice(0, 8) + '...' : 'Unknown'),
      avatar: c.author?.avatar || null,
      followers: c.author?.followers || 0,
      text: c.content?.text || '',
      createdAt: c.created_at,
      pnlPct: c.holding?.pnl_pct || null,
    }));
    return { count: list.length, callers };
  } catch (err) {
    console.warn('[telegram-client] GMGN callout fetch failed for', address.slice(0, 8), err.message);
    return null;
  }
}

/**
 * Fetch FOMO traders count from GMGN API (buyers > $500 in last 30s).
 */
async function fetchFomoTraders(address) {
  try {
    const client = await getGmgnCycleTLS();
    const url = `https://gmgn.ai/vas/api/v1/agged_token_trades/sol/${address}?period=30s&tag=event_fomo&min_amount_usd=500&limit=100`;
    const resp = await client(url, {
      client: 'chrome131',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://gmgn.ai/',
        'Origin': 'https://gmgn.ai',
      },
    }, 'GET');
    if (resp.status !== 200) return null;

    let data = resp.data;
    if (typeof data === 'string') data = JSON.parse(data);
    if (Buffer.isBuffer(data)) data = JSON.parse(data.toString('utf8'));

    if (data.code !== 0 || !data.data?.trades) return null;

    // Count unique buyers
    const buyers = new Set();
    for (const group of data.data.trades) {
      for (const trade of (group.trades || [])) {
        if (trade.buy_count > 0 && trade.buy_usd_amount) {
          buyers.add(trade.wallet_address);
        }
      }
    }
    return { count: buyers.size };
  } catch (err) {
    console.warn('[telegram-client] GMGN FOMO fetch failed for', address.slice(0, 8), err.message);
    return null;
  }
}

/**
 * Fetch KOL (Key Opinion Leader) count from GMGN API.
 * Returns { count } or null on failure.
 */
async function fetchKolTraders(address) {
  try {
    const client = await getGmgnCycleTLS();
    const url = `https://gmgn.ai/vas/api/v1/agged_token_trades/sol/${address}?period=30s&tag=kol&limit=100`;
    const resp = await client(url, {
      client: 'chrome131',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://gmgn.ai/',
        'Origin': 'https://gmgn.ai',
      },
    }, 'GET');
    if (resp.status !== 200) return null;

    let data = resp.data;
    if (typeof data === 'string') data = JSON.parse(data);
    if (Buffer.isBuffer(data)) data = JSON.parse(data.toString('utf8'));

    if (data.code !== 0 || !data.data?.trades) return null;

    // Count unique KOL wallets
    const kols = new Set();
    for (const group of data.data.trades) {
      for (const trade of (group.trades || [])) {
        if (trade.buy_count > 0 && trade.name) {
          kols.add(trade.wallet_address);
        }
      }
    }
    return { count: kols.size };
  } catch (err) {
    console.warn('[telegram-client] GMGN KOL fetch failed for', address.slice(0, 8), err.message);
    return null;
  }
}

/**
 * Fetch community callouts count from GMGN API (klines with community callouts).
 * Returns { count } or null on failure.
 */
async function fetchCommunityCallouts(address) {
  try {
    const client = await getGmgnCycleTLS();
    const url = `https://gmgn.ai/api/v1/token/sol/${address}/community/klines?period=30s`;
    const resp = await client(url, {
      client: 'chrome131',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://gmgn.ai/',
        'Origin': 'https://gmgn.ai',
      },
    }, 'GET');
    if (resp.status !== 200) return null;

    let data = resp.data;
    if (typeof data === 'string') data = JSON.parse(data);
    if (Buffer.isBuffer(data)) data = JSON.parse(data.toString('utf8'));

    if (data.code !== 0 || !data.data?.klines) return null;

    // Count total community callouts across all klines
    let total = 0;
    for (const kline of data.data.klines) {
      total += (kline.total || 0);
      if (kline.callouts) {
        total += kline.callouts.length;
      }
    }
    // Use the max of total and sum of callouts lengths
    const calloutSum = data.data.klines.reduce((sum, k) => sum + (k.callouts?.length || 0), 0);
    const count = Math.max(total, calloutSum);
    return { count };
  } catch (err) {
    console.warn('[telegram-client] GMGN community klines fetch failed for', address.slice(0, 8), err.message);
    return null;
  }
}

/**
 * Fetch PUMP traders count from GMGN API (buyers > $500 on PumpFun in last 30s).
 * Returns { count } or null on failure.
 */
async function fetchPumpTraders(address) {
  try {
    const client = await getGmgnCycleTLS();
    const url = `https://gmgn.ai/vas/api/v1/agged_token_trades/sol/${address}?period=30s&tag=event_pumpfun&min_amount_usd=500&limit=100`;
    const resp = await client(url, {
      client: 'chrome131',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://gmgn.ai/',
        'Origin': 'https://gmgn.ai',
      },
    }, 'GET');
    if (resp.status !== 200) return null;

    let data = resp.data;
    if (typeof data === 'string') data = JSON.parse(data);
    if (Buffer.isBuffer(data)) data = JSON.parse(data.toString('utf8'));

    if (data.code !== 0 || !data.data?.trades) return null;

    // Count unique buyer wallets
    const buyers = new Set();
    for (const group of data.data.trades) {
      for (const trade of (group.trades || [])) {
        if (trade.buy_count > 0 && trade.buy_usd_amount) {
          buyers.add(trade.wallet_address);
        }
      }
    }
    return { count: buyers.size };
  } catch (err) {
    console.warn('[telegram-client] GMGN PUMP fetch failed for', address.slice(0, 8), err.message);
    return null;
  }
}

/**
 * Fetch Axiom traders count from GMGN API (buyers > $500 on Axiom in last 30s).
 * Returns { count } or null on failure.
 */
async function fetchAxiomTraders(address) {
  try {
    const client = await getGmgnCycleTLS();
    const url = `https://gmgn.ai/vas/api/v1/agged_token_trades/sol/${address}?period=30s&tag=event_axiom&min_amount_usd=500&limit=100`;
    const resp = await client(url, {
      client: 'chrome131',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://gmgn.ai/',
        'Origin': 'https://gmgn.ai',
      },
    }, 'GET');
    if (resp.status !== 200) return null;

    let data = resp.data;
    if (typeof data === 'string') data = JSON.parse(data);
    if (Buffer.isBuffer(data)) data = JSON.parse(data.toString('utf8'));

    if (data.code !== 0 || !data.data?.trades) return null;

    // Count unique buyer wallets
    const buyers = new Set();
    for (const group of data.data.trades) {
      for (const trade of (group.trades || [])) {
        if (trade.buy_count > 0 && trade.buy_usd_amount) {
          buyers.add(trade.wallet_address);
        }
      }
    }
    return { count: buyers.size };
  } catch (err) {
    console.warn('[telegram-client] GMGN Axiom traders fetch failed for', address.slice(0, 8), err.message);
    return null;
  }
}

/**
 * Fetch token info from telemetry.io and save to DB.
 */
async function fetchTokenInfo(address, messageRecord) {
  try {
    const quote = await fetchQuote('solana', address);
    if (!quote) return;

    // Calculate age: prefer telemetry createdAt, fallback to message text parsing
    let ageMinutes = null;
    if (quote.createdAt) {
      const createdMs = new Date(quote.createdAt).getTime();
      if (Number.isFinite(createdMs) && createdMs > 0) {
        ageMinutes = Math.round((Date.now() - createdMs) / 60000);
      }
    }
    if (ageMinutes === null) {
      ageMinutes = extractAgeMinutes(messageRecord.text || '');
    }

    // Reject tokens with market cap < $42,000
    const mc = quote.marketCapUsd || 0;
    if (mc > 0 && mc < 42000) {
      console.log(`[telegram-client] Rejected ${quote.symbol || address.slice(0, 8)}: market cap $${mc} < $42,000`);
      return;
    }

    // Reject tokens older than 1 hour (age > 60 minutes)
    if (ageMinutes !== null && ageMinutes > 60) {
      console.log(`[telegram-client] Rejected ${quote.symbol || address.slice(0, 8)}: age ${ageMinutes}min > 60min (created: ${quote.createdAt || 'from message'})`);
      return;
    }

    // Fetch all GMGN filters in parallel
    const [axiomRes, fomoRes, kolRes, communityRes, pumpRes, axiomTradersRes] = await Promise.all([
      fetchAxiomCallouts(address),
      fetchFomoTraders(address),
      fetchKolTraders(address),
      fetchCommunityCallouts(address),
      fetchPumpTraders(address),
      fetchAxiomTraders(address),
    ]);

    const axiomCallouts = axiomRes?.count || 0;
    const fomoTraders = fomoRes?.count || 0;
    const kolTraders = kolRes?.count || 0;
    const communityCallouts = communityRes?.count || 0;
    const pumpTraders = pumpRes?.count || 0;
    const axiomTraders = axiomTradersRes?.count || 0;

    // Reject if no Axiom activity (need at least 1 Axiom callout or Axiom trader)
    if (axiomCallouts === 0 && axiomTraders === 0) {
      console.log(`[telegram-client] Rejected ${quote.symbol || address.slice(0, 8)}: no Axiom callouts or Axiom traders`);
      return;
    }

    const detected = {
      id: `${messageRecord.id}_${address}`,
      messageId: messageRecord.id,
      chatId: messageRecord.chatId,
      chatTitle: messageRecord.chatTitle,
      address,
      symbol: quote.symbol || null,
      name: quote.name || null,
      marketCapUsd: quote.marketCapUsd || null,
      priceUsd: quote.priceUsd || null,
      logo: quote.imageUrl || null,
      ageMinutes,
      createdAt: quote.createdAt || null,
      axiomCallouts,
      axiomCallers: axiomRes?.callers || null,
      fomoTraders,
      kolTraders,
      communityCallouts,
      pumpTraders,
      axiomTraders,
      detectedAt: messageRecord.date || Date.now(),
    };

    saveDetectedToken(detected);
    console.log(`[telegram-client] Token detected: ${quote.symbol || address.slice(0, 8)} (MC: ${quote.marketCapUsd}) from ${messageRecord.chatTitle} | Axiom:${axiomCallouts} FOMO:${fomoTraders} KOL:${kolTraders} Comm:${communityCallouts} Pump:${pumpTraders} AxiomT:${axiomTraders}`);

    // Send Telegram notification for detected token (only once per 24h)
    if (!isTelegramTokenNotified(address)) {
      sendDetectedTokenNotification(detected).then(() => {
        markTelegramTokenNotified(address);
      }).catch((err) => {
        console.error('[telegram-client] Failed to send notification:', err.message);
      });
    } else {
      console.log(`[telegram-client] Skipping notification for ${quote.symbol || address.slice(0, 8)}: already notified within 24h`);
    }
  } catch (err) {
    // Parse age from message
    const ageMinutes = extractAgeMinutes(messageRecord.text || '');

    // Reject tokens older than 1 hour (age > 60 minutes)
    if (ageMinutes !== null && ageMinutes > 60) {
      console.log(`[telegram-client] Rejected ${address.slice(0, 8)}: age ${ageMinutes}min > 60min (no telemetry)`);
      return;
    }

    // Fetch all GMGN filters in parallel (even without telemetry)
    const [axiomRes, fomoRes, kolRes, communityRes, pumpRes, axiomTradersRes] = await Promise.all([
      fetchAxiomCallouts(address),
      fetchFomoTraders(address),
      fetchKolTraders(address),
      fetchCommunityCallouts(address),
      fetchPumpTraders(address),
      fetchAxiomTraders(address),
    ]);

    const axiomCallouts = axiomRes?.count || 0;
    const fomoTraders = fomoRes?.count || 0;
    const kolTraders = kolRes?.count || 0;
    const communityCallouts = communityRes?.count || 0;
    const pumpTraders = pumpRes?.count || 0;
    const axiomTraders = axiomTradersRes?.count || 0;

    // Reject if no Axiom activity (need at least 1 Axiom callout or Axiom trader)
    if (axiomCallouts === 0 && axiomTraders === 0) {
      console.log(`[telegram-client] Rejected ${address.slice(0, 8)}: no Axiom callouts or Axiom traders (no telemetry)`);
      return;
    }

    // Still save the address even if telemetry fails
    const detected = {
      id: `${messageRecord.id}_${address}`,
      messageId: messageRecord.id,
      chatId: messageRecord.chatId,
      chatTitle: messageRecord.chatTitle,
      address,
      symbol: null,
      name: null,
      marketCapUsd: null,
      priceUsd: null,
      logo: null,
      ageMinutes,
      createdAt: null,
      axiomCallouts,
      axiomCallers: axiomRes?.callers || null,
      fomoTraders,
      kolTraders,
      communityCallouts,
      pumpTraders,
      axiomTraders,
      detectedAt: messageRecord.date || Date.now(),
    };
    saveDetectedToken(detected);
    console.log(`[telegram-client] Token saved (no telemetry): ${address.slice(0, 8)} - ${err.message} | Axiom:${axiomCallouts} FOMO:${fomoTraders} KOL:${kolTraders} Comm:${communityCallouts} Pump:${pumpTraders} AxiomT:${axiomTraders}`);

    // Send Telegram notification for detected token (only once per 24h)
    if (!isTelegramTokenNotified(address)) {
      sendDetectedTokenNotification(detected).then(() => {
        markTelegramTokenNotified(address);
      }).catch((e) => {
        console.error('[telegram-client] Failed to send notification:', e.message);
      });
    } else {
      console.log(`[telegram-client] Skipping notification for ${address.slice(0, 8)}: already notified within 24h`);
    }
  }
}

/**
 * Send a Telegram notification for a detected token.
 */
async function sendDetectedTokenNotification(t) {
  const symbol = t.symbol || t.address.slice(0, 8);
  const name = t.name || '';
  const mc = t.marketCapUsd ? formatMarketCap(t.marketCapUsd) : '—';
  const price = t.priceUsd ? `$${Number(t.priceUsd).toFixed(6)}` : '—';
  const age = t.ageMinutes != null ? `${t.ageMinutes}m` : '—';
  const axiom = t.axiomCallouts || 0;
  const fomo = t.fomoTraders || 0;
  const kol = t.kolTraders || 0;
  const community = t.communityCallouts || 0;
  const pump = t.pumpTraders || 0;
  const axiomT = t.axiomTraders || 0;

  const filters = [];
  if (axiom > 0) filters.push(`Axiom: ${axiom} calls`);
  if (fomo > 0) filters.push(`FOMO: ${fomo} buyers`);
  if (kol > 0) filters.push(`KOL: ${kol}`);
  if (community > 0) filters.push(`Community: ${community}`);
  if (pump > 0) filters.push(`Pump: ${pump}`);
  if (axiomT > 0) filters.push(`AxiomT: ${axiomT}`);

  const msg = `🔔 <b>Nuevo token detectado en Telegram</b>\n` +
    `Canal: ${t.chatTitle || t.chatId}\n` +
    `Symbol: ${symbol}\n` +
    (name ? `Name: ${name}\n` : '') +
    `Address: <code>${t.address}</code>\n` +
    `MK: ${mc} | Price: ${price} | Age: ${age}\n` +
    (filters.length > 0 ? filters.join(' | ') + '\n' : '') +
    `<a href="https://fomo.family/tokens/solana/${t.address}">FOMO</a> | ` +
    `<a href="https://gmgn.ai/sol/token/${t.address}">GMGN</a> | ` +
    `<a href="https://pump.fun/${t.address}">PumpFun</a> | ` +
    `<a href="paper-terminal://trade/solana:${t.address}">App</a>`;

  await sendTelegramMessage(msg);
}

export async function startTelegramClient() {
  if (connecting || connected) return { ok: connected, message: connected ? 'Already connected' : 'Connecting...' };

  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const phone = process.env.TELEGRAM_PHONE;

  if (!apiId || !apiHash) {
    lastError = 'TELEGRAM_API_ID and TELEGRAM_API_HASH are required (get from https://my.telegram.org)';
    console.error('[telegram-client]', lastError);
    return { ok: false, message: lastError };
  }

  connecting = true;
  monitoredChannels = parseChannels();

  try {
    const sessionStr = loadSession();
    const session = new StringSession(sessionStr);
    client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true,
    });

    await client.connect();

    // If not authorized, need to sign in
    if (!await client.checkAuthorization()) {
      if (!phone) {
        lastError = 'TELEGRAM_PHONE required for first authentication. Set it in .env and restart.';
        console.error('[telegram-client]', lastError);
        console.error('[telegram-client] TIP: Run "node auth-telegram.js" locally to get a session string, then set TELEGRAM_SESSION in your env.');
        connecting = false;
        return { ok: false, message: lastError };
      }

      console.log('[telegram-client] Starting authentication for', phone);
      await client.sendCode({ apiId, apiHash }, phone);
      console.log('[telegram-client] Code sent to', phone);

      // For Railway/non-interactive: check for TELEGRAM_CODE env
      const code = process.env.TELEGRAM_CODE;
      if (code) {
        try {
          await client.signIn({ apiId, apiHash }, phone, code, async () => process.env.TELEGRAM_2FA_PASSWORD || '');
          console.log('[telegram-client] Signed in successfully');
        } catch (err) {
          lastError = `Sign in failed: ${err.message}`;
          console.error('[telegram-client]', lastError);
          connecting = false;
          return { ok: false, message: lastError };
        }
      } else {
        lastError = 'TELEGRAM_CODE required. Check your Telegram messages and set TELEGRAM_CODE env var, then restart.';
        console.error('[telegram-client]', lastError);
        console.error('[telegram-client] TIP: Or run "node auth-telegram.js" locally to get a session string, then set TELEGRAM_SESSION in your env (recommended for Railway).');
        connecting = false;
        return { ok: false, message: lastError };
      }
    }

    // Save session
    const newSession = client.session.save();
    saveSession(newSession);

    // Register message handler
    client.addEventHandler(async (event) => {
      try {
        const msg = event.message;
        if (!msg) return;

        const chat = await msg.getChat();
        const chatId = chat?.id?.toString() || 'unknown';
        const chatTitle = chat?.title || chat?.firstName || chat?.username || 'Unknown';

        // Filter monitored channels if configured
        if (monitoredChannels.length > 0) {
          const chatUsername = (chat?.username || '').toLowerCase();
          const chatIdStr = chatId;
          // Normalize channel ID: strip -100 prefix for comparison
          const normalizedId = chatIdStr.replace(/^-100/, '');
          const isMonitored = monitoredChannels.some((ch) => {
            const chNorm = ch.toLowerCase().replace(/^@/, '').replace(/^-100/, '');
            return (
              chNorm === chatUsername ||
              chNorm === chatIdStr ||
              chNorm === normalizedId ||
              ch === chatTitle
            );
          });
          if (!isMonitored) return;
        }

        const sender = await msg.getSender();
        const senderName = sender?.firstName || sender?.title || sender?.username || 'Unknown';
        const senderId = sender?.id?.toString() || '';

        const hasMedia = !!msg.media;
        let mediaType = null;
        if (hasMedia) {
          if (msg.photo) mediaType = 'photo';
          else if (msg.video) mediaType = 'video';
          else if (msg.document) mediaType = 'document';
          else if (msg.sticker) mediaType = 'sticker';
          else mediaType = 'other';
        }

        const text = msg.text || msg.message || '';
        const record = {
          id: `${chatId}_${msg.id}`,
          chatId,
          chatTitle,
          senderId,
          senderName,
          text,
          date: msg.date ? msg.date * 1000 : Date.now(),
          hasMedia,
          mediaType,
          raw: {
            messageId: msg.id,
            chatId,
            senderId,
            date: msg.date,
          },
        };

        saveTelegramMessage(record);
        messageCount++;
        console.log(`[telegram-client] Message detected from channel "${chatTitle}" (id: ${chatId}, username: ${chat?.username || 'none'}): ${text.slice(0, 80)}`);

        // Detect token addresses (Solana contract addresses) in the message
        const addresses = extractSolanaAddresses(text);
        if (addresses.length > 0) {
          console.log(`[telegram-client] Detected ${addresses.length} address(es) in message`);
          for (const address of addresses) {
            // Fetch token info from telemetry (async, don't block)
            fetchTokenInfo(address, record).catch((err) => {
              console.error('[telegram-client] Failed to fetch token info for', address, err.message);
            });
          }
        }
      } catch (err) {
        console.error('[telegram-client] Error processing message:', err.message);
      }
    }, new NewMessage({}));

    connected = true;
    connecting = false;
    lastError = null;
    console.log('[telegram-client] Connected and listening for messages');
    console.log('[telegram-client] Monitored channels:', monitoredChannels.length ? monitoredChannels.join(', ') : 'ALL');
    return { ok: true, message: 'Connected and listening' };
  } catch (err) {
    lastError = err.message;
    connecting = false;
    console.error('[telegram-client] Connection failed:', err.message);
    return { ok: false, message: lastError };
  }
}

export function stopTelegramClient() {
  if (client) {
    try {
      client.disconnect();
    } catch {}
    client = null;
  }
  connected = false;
  connecting = false;
  console.log('[telegram-client] Disconnected');
}

export function getTelegramClientStatus() {
  return {
    connected,
    connecting,
    lastError,
    messageCount,
    monitoredChannels,
    hasSession: !!loadSession(),
    hasCredentials: Boolean(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH),
  };
}

export { client as telegramClient };