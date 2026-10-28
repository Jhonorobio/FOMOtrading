/**
 * Paper Terminal — self-hosted server.
 * Exposes the HTTP API consumed by the Chrome extension (and, in the future, an Expo app).
 * Runs on $PORT (default 3001). Data lives in server/data/paper.db (SQLite via sql.js).
 */
import express from 'express';
import cors from 'cors';

import './env.js';
import { signSession, getSessionUser, deleteSession, createSession, verifyAccessCode, ensurePersonalUser } from './auth.js';
import { initDb, get } from './db.js';
import {
  getOrCreateAccount, startAccount, resetAccount, placeTrade, closePosition,
  getPortfolio, getTrades, getClosedTrades, exportUserData, updateProfile,
  recordConsent, deleteAccountAndData,
} from './trading.js';
import { fetchQuote, fetchPriceHistory, TELEMETRY_TOKEN, fetchTokenLogo } from './market-data.js';

const PORT = Number(process.env.PORT ?? 3001);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[server] FATAL: JWT_SECRET is required. Set it in .env');
  process.exit(1);
}

const FEE_RATE = Number(process.env.FEE_RATE ?? 0.001);
const SLIPPAGE_RATE = Number(process.env.SLIPPAGE_RATE ?? 0.005);
const MIN_TRADE_USD = Number(process.env.MIN_TRADE_USD ?? 5);
const MAX_TRADE_USD = Number(process.env.MAX_TRADE_USD ?? 100000);
const STARTING_BALANCE_PRESETS = (process.env.STARTING_BALANCE_PRESETS ?? '1000,5000,10000,25000,50000,100000')
  .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
const MIN_STARTING_BALANCE = Number(process.env.MIN_STARTING_BALANCE ?? 1);
const MAX_STARTING_BALANCE = Number(process.env.MAX_STARTING_BALANCE ?? 1000000);
const MINIMUM_AGE = Number(process.env.MINIMUM_AGE ?? 18);

const app = express();
app.use(cors());
app.use(express.json());

/* ---------------- auth helpers ---------------- */

function extractToken(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function optionalSession(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = getSessionUser(token).user;
    } catch {
      // stale/invalid session: ignore for optional endpoints
    }
  }
  next();
}

function requireSession(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: { code: 'NOT_SIGNED_IN', message: 'Sign in to continue.' } });
  try {
    req.user = getSessionUser(token).user;
    next();
  } catch {
    res.status(401).json({ error: { code: 'SESSION_INVALID', message: 'Session invalid or expired. Sign in again.' } });
  }
}

/** Position for the current asset (used by asset-state). */
function getPosition(userId, chainId, address) {
  const row = get(
    'SELECT p.* FROM positions p JOIN accounts a ON a.id = p.account_id ' +
    'WHERE a.user_id = ? AND p.chain_id = ? AND p.address = ?',
    [userId, chainId, address]
  );
  if (!row) return null;
  return {
    assetId: row.cycle_id,
    chainId: row.chain_id,
    address: row.address,
    symbol: row.symbol,
    quantity: row.quantity,
    averageEntryPrice: row.average_entry_price,
    costBasis: row.cost_basis,
    entryMarketCapUsd: row.entry_market_cap_usd,
    openedAt: row.opened_at,
    cycleId: row.cycle_id,
  };
}

/* ---------------- public endpoints ---------------- */

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'paper-terminal-server', time: new Date().toISOString() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    feeRate: FEE_RATE,
    slippageRate: SLIPPAGE_RATE,
    minTradeUsd: MIN_TRADE_USD,
    maxTradeUsd: MAX_TRADE_USD,
    startingBalancePresets: STARTING_BALANCE_PRESETS,
    minStartingBalance: MIN_STARTING_BALANCE,
    maxStartingBalance: MAX_STARTING_BALANCE,
    minimumAge: MINIMUM_AGE,
    marketDataProvider: TELEMETRY_TOKEN ? 'telemetry' : 'dexscreener',
  });
});

app.get('/api/quote', async (req, res, next) => {
  try {
    const { chain, address } = req.query;
    if (!chain || !address) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'chain and address are required.' } });
    const quote = await fetchQuote(chain, address);
    res.json({ quote });
  } catch (err) {
    next(err);
  }
});

app.get('/api/token-logo', async (req, res, next) => {
  try {
    const { chain, address } = req.query;
    if (!chain || !address) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'chain and address are required.' } });
    const dataUrl = await fetchTokenLogo(address);
    res.json({ dataUrl: dataUrl || null });
  } catch (err) {
    next(err);
  }
});

app.get('/api/price-history', async (req, res, next) => {
  try {
    const { chain, address, from, to } = req.query;
    if (!chain || !address) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'chain and address are required.' } });
    const history = await fetchPriceHistory(chain, address, from, to);
    res.json(history);
  } catch (err) {
    next(err);
  }
});

/* ---------------- session-required endpoints ---------------- */

app.get('/api/me', requireSession, async (req, res) => {
  const acct = getOrCreateAccount(req.user.id);
  res.json({
    account: acct ? { id: acct.id, cashBalance: acct.cashBalance, startingBalance: acct.startingBalance, needsSetup: acct.needsSetup } : null,
    needsSetup: !acct || acct.needsSetup,
    needsConsent: false,
  });
});

app.get('/api/asset-state', optionalSession, async (req, res, next) => {
  try {
    const { chain, address } = req.query;
    if (!chain || !address) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'chain and address are required.' } });

    const quote = await fetchQuote(chain, address);
    let account = null;
    let position = null;
    let needsSetup = false;

    if (req.user) {
      const acct = getOrCreateAccount(req.user.id);
      if (!acct || acct.needsSetup) {
        needsSetup = true;
      } else {
        account = { id: acct.id, cashBalance: acct.cashBalance, startingBalance: acct.startingBalance };
        position = getPosition(req.user.id, chain, address);
        if (position) {
          // Augment position with live price and P&L so the extension can render them.
          position.currentPrice = quote.priceUsd;
          position.marketCapUsd = quote.marketCapUsd;
          position.symbol = quote.symbol || position.symbol;
          position.unrealizedPnl = (quote.priceUsd - position.averageEntryPrice) * position.quantity;
          position.unrealizedPnlPct = position.averageEntryPrice > 0
            ? ((quote.priceUsd - position.averageEntryPrice) / position.averageEntryPrice) * 100
            : 0;
          position.marketValue = position.quantity * quote.priceUsd;
        }
      }
    }

    res.json({ quote, account, position, needsSetup });
  } catch (err) {
    next(err);
  }
});

app.get('/api/portfolio', requireSession, async (req, res, next) => {
  try {
    const tzOffset = Number(req.query.tzOffset ?? new Date().getTimezoneOffset());
    const data = await getPortfolio(req.user.id, tzOffset);
    res.json({
      account: data.account,
      performance: data.performance,
      positions: data.positions,
      tradingStyle: data.tradingStyle,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/trades', requireSession, (req, res, next) => {
  try {
    const data = getTrades(req.user.id, {
      side: req.query.side,
      asset: req.query.asset,
      from: req.query.from,
      to: req.query.to,
      scope: req.query.scope,
      limit: req.query.limit,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

app.get('/api/closed-trades', requireSession, (req, res, next) => {
  try {
    res.json(getClosedTrades(req.user.id));
  } catch (err) {
    next(err);
  }
});

app.post('/api/trades', requireSession, async (req, res, next) => {
  try {
    const { chain, address, side, amountUsd, percent, clientRequestId } = req.body;
    if (!chain || !address || !side) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'chain, address and side are required.' } });

    const quote = await fetchQuote(chain, address);
    const symbol = req.body.symbol || quote.symbol || address.slice(0, 6).toUpperCase();

    const { trade, account, position } = placeTrade(req.user.id, {
      chainId: chain, address, symbol, side, amountUsd, percent, clientRequestId, quote,
    });

    res.json({ trade, account, position });
  } catch (err) {
    next(err);
  }
});

app.post('/api/positions/close', requireSession, async (req, res, next) => {
  try {
    const { chain, address, clientRequestId } = req.body;
    if (!chain || !address) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'chain and address are required.' } });

    const quote = await fetchQuote(chain, address);
    const { trade, account, position } = closePosition(req.user.id, {
      chainId: chain, address, clientRequestId, quote,
    });

    res.json({ trade, account, position });
  } catch (err) {
    next(err);
  }
});

app.post('/api/account/start', requireSession, async (req, res, next) => {
  try {
    const { startingBalance } = req.body;
    if (!(startingBalance > 0)) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'startingBalance is required.' } });
    const account = startAccount(req.user.id, Number(startingBalance));
    res.json({ account });
  } catch (err) {
    next(err);
  }
});

app.post('/api/account/reset', requireSession, async (req, res, next) => {
  try {
    const { startingBalance } = req.body;
    if (!(startingBalance > 0)) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'startingBalance is required.' } });
    const account = resetAccount(req.user.id, Number(startingBalance));
    res.json({ account });
  } catch (err) {
    next(err);
  }
});

app.post('/api/account/delete', requireSession, async (req, res, next) => {
  try {
    await deleteAccountAndData(req.user.id);
    const token = extractToken(req);
    if (token) deleteSession(token);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/profile', requireSession, async (req, res, next) => {
  try {
    const { displayName, photoUrl } = req.body;
    const result = await updateProfile(req.user.id, { displayName, photoUrl });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/consent', requireSession, async (_req, res) => {
  res.json(recordConsent('placeholder'));
});

/* ---------------- auth (personal access code) ---------------- */

app.post('/api/auth/code', async (req, res, next) => {
  try {
    const { code } = req.body;
    const user = verifyAccessCode(code);
    ensurePersonalUser();
    const { token } = createSession(user.id);
    res.json({ sessionToken: token, user: { id: user.id, email: user.email, displayName: user.name, photoUrl: user.photoUrl } });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', requireSession, async (req, res) => {
  const token = extractToken(req);
  if (token) deleteSession(token);
  res.json({ ok: true });
});

/* ---------------- export (raw file) ---------------- */

app.get('/api/export', requireSession, async (req, res, next) => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const file = exportUserData(req.user.id, format);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.text);
  } catch (err) {
    next(err);
  }
});

/* ---------------- error handler ---------------- */

function errorToStatus(code) {
  switch (code) {
    case 'NOT_SIGNED_IN':
    case 'SESSION_INVALID':
    case 'INVALID_SESSION':
    case 'SESSION_REVOKED':
      return 401;
    case 'ACCOUNT_NOT_FOUND':
    case 'ACCOUNT_SETUP_REQUIRED':
    case 'ASSET_NOT_FOUND':
    case 'NO_POSITION':
    case 'INSUFFICIENT_POSITION':
      return 404;
    case 'INSUFFICIENT_BALANCE':
      return 403;
    case 'BAD_REQUEST':
    case 'INVALID_AMOUNT':
    case 'INVALID_PERCENT':
    case 'MIN_TRADE_USD':
    case 'MAX_TRADE_USD':
      return 400;
    case 'MARKET_DATA_INVALID':
    case 'MARKET_DATA_RATE_LIMITED':
    case 'MARKET_DATA_ERROR':
      return 502;
    case 'ACCOUNT_ALREADY_STARTED':
      return 409;
    default:
      return 500;
  }
}

app.use((err, _req, res, _next) => {
  const message = err && err.message ? err.message : String(err || 'Internal server error');
  const code = err && err.code ? err.code : (message.includes(':') ? message.split(':')[0] : 'SERVER_ERROR');
  const status = errorToStatus(code);
  console.error('[server]', status, code, message);
  if (process.env.NODE_ENV !== 'production') {
    console.error('[server] stack:', err && err.stack ? err.stack : String(err));
    console.error('[server] err obj:', JSON.stringify(err));
  }
  res.status(status).json({ error: { code, message: message.replace(/^[A-Z_]+:/, ''), details: null } });
});

async function main() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`[server] Paper Terminal server listening on http://localhost:${PORT}`);
    console.log(`[server] JWT_SECRET configured: ${JWT_SECRET ? 'yes' : 'no'}`);
    console.log(`[server] Auth: personal access code (FOMO / fomo)`);
  });
}

main().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});

export { app };
