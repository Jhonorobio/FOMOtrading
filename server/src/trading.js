/**
 * Paper trading engine.
 * Every fill is simulated at live prices. No wallet, no real orders, no real funds.
 * Kept pure (receives a quote, returns trades/account/positions) so it can be reused
 * by both the Chrome extension and a future Expo/React Native app through the same HTTP API.
 */
import { run, all, get } from './db.js';
import { fetchQuote, fetchQuotesBatch } from './market-data.js';

const FEE_RATE = Number(process.env.FEE_RATE ?? 0.001);
const SLIPPAGE_RATE = Number(process.env.SLIPPAGE_RATE ?? 0.005);
const MIN_TRADE_USD = Number(process.env.MIN_TRADE_USD ?? 5);
const MAX_TRADE_USD = Number(process.env.MAX_TRADE_USD ?? 100000);

const now = () => Date.now();

/** Normalise a raw position row into the shape the extension expects. */
function positionRowToPosition(row) {
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

/** Normalise a raw trade row into the shape the extension expects. */
function tradeRowToTrade(row) {
  return {
    id: row.id,
    chainId: row.chain_id,
    address: row.address,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    executionPrice: row.execution_price,
    marketPrice: row.market_price,
    requestedValue: row.requested_value_usd,
    fee: row.fee_usd,
    slippage: row.slippage_usd,
    cashAfter: row.cash_after,
    liquidityUsd: row.liquidity_usd,
    marketCapUsd: row.market_cap_usd,
    status: row.status,
    timestamp: row.timestamp,
    total: row.total_usd,
    cycleId: row.cycle_id,
  };
}

/** Normalise a raw closed-trade row into the shape the extension expects. */
function closedRowToClosed(row) {
  return {
    id: row.id,
    chainId: row.chain_id,
    address: row.address,
    symbol: row.symbol,
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    entryMarketCapUsd: row.entry_market_cap_usd,
    exitMarketCapUsd: row.exit_market_cap_usd,
    positionSizeUsd: row.position_size_usd,
    proceedsUsd: row.proceeds_usd,
    fees: row.fees_usd,
    realizedPnl: row.realized_pnl_usd,
    returnPct: row.return_pct,
    buyCount: row.buy_count,
    sellCount: row.sell_count,
    holdMs: row.hold_ms,
    entryTime: row.entry_time,
    exitTime: row.exit_time,
    cycleId: row.cycle_id,
    assetId: row.asset_id,
  };
}

/** Get or create an account for a user. Returns null when the user still needs setup. */
export function getOrCreateAccount(userId) {
  const acct = get(
    'SELECT id, user_id, cash_balance, starting_balance, needs_setup, created_at, updated_at FROM accounts WHERE user_id = ?',
    [userId]
  );
  if (!acct) return null;
  return {
    id: acct.id,
    userId: acct.user_id,
    cashBalance: acct.cash_balance,
    startingBalance: acct.starting_balance,
    needsSetup: acct.needs_setup === 1,
    createdAt: acct.created_at,
    updatedAt: acct.updated_at,
  };
}

/** Create a fresh paper account with starting capital. */
export function startAccount(userId, startingBalance) {
  const existing = get('SELECT id FROM accounts WHERE user_id = ?', [userId]);
  if (existing) throw new Error('ACCOUNT_ALREADY_STARTED');

  // The user must already exist (created during sign-in via findOrCreateUser).
  const user = get('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('USER_NOT_FOUND');

  const id = crypto.randomUUID();
  const createdAt = now();
  run(
    'INSERT INTO accounts (id, user_id, cash_balance, starting_balance, needs_setup, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    [id, userId, startingBalance, startingBalance, createdAt, createdAt]
  );
  return { id, userId, cashBalance: startingBalance, startingBalance, needsSetup: false, createdAt, updatedAt: createdAt };
}

/** Reset an account: close open positions, keep history, start with new capital. */
export function resetAccount(userId, startingBalance) {
  const acct = get('SELECT id, cash_balance, starting_balance FROM accounts WHERE user_id = ?', [userId]);
  if (!acct) throw new Error('ACCOUNT_NOT_FOUND');

  const id = acct.id;
  const closedAt = now();

  // Close every open position at its last-known price (no live quote needed here: record a synthetic flat close).
  const positions = all('SELECT * FROM positions WHERE account_id = ?', [id]);
  for (const p of positions) {
    const proceeds = p.quantity * p.average_entry_price;
    const realizedPnl = proceeds - p.cost_basis;
    const returnPct = p.cost_basis > 0 ? (realizedPnl / p.cost_basis) * 100 : 0;
    run(
      'INSERT INTO closed_trades (id, account_id, chain_id, address, symbol, entry_price, exit_price, ' +
      'entry_market_cap_usd, exit_market_cap_usd, position_size_usd, proceeds_usd, fees_usd, realized_pnl_usd, ' +
      'return_pct, buy_count, sell_count, hold_ms, entry_time, exit_time, cycle_id, asset_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        crypto.randomUUID(), id, p.chain_id, p.address, p.symbol, p.average_entry_price, p.average_entry_price,
        p.entry_market_cap_usd, null, p.cost_basis, proceeds, 0, realizedPnl, returnPct, 1, 1,
        closedAt - p.opened_at, p.opened_at, closedAt, p.cycle_id, p.cycle_id,
      ]
    );
    run('DELETE FROM positions WHERE id = ?', [p.id]);
  }

  run('UPDATE accounts SET cash_balance = ?, starting_balance = ?, updated_at = ? WHERE id = ?', [
    startingBalance, startingBalance, closedAt, id,
  ]);

  return {
    id, userId, cashBalance: startingBalance, startingBalance, needsSetup: false,
    createdAt: acct.created_at, updatedAt: closedAt,
  };
}

/** Place a simulated trade (buy or sell). */
export function placeTrade(userId, { chainId, address, symbol, side, amountUsd, percent, clientRequestId, quote }) {
  const acctRow = get('SELECT * FROM accounts WHERE user_id = ?', [userId]);
  if (!acctRow) throw new Error('ACCOUNT_NOT_FOUND');
  if (acctRow.needs_setup === 1) throw new Error('ACCOUNT_SETUP_REQUIRED');

  const account = {
    id: acctRow.id, userId: acctRow.user_id, cashBalance: acctRow.cash_balance,
    startingBalance: acctRow.starting_balance, needsSetup: false,
    createdAt: acctRow.created_at, updatedAt: acctRow.updated_at,
  };

  const timestamp = now();
  const priceUsd = Number(quote.priceUsd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error('MARKET_DATA_INVALID');

  const executionPrice = side === 'BUY'
    ? priceUsd * (1 + SLIPPAGE_RATE)
    : priceUsd * (1 - SLIPPAGE_RATE);

  let quantity, requestedValue, feeUsd, slippageUsd, proceeds, cashAdd, cashAfter;

  if (side === 'BUY') {
    requestedValue = Math.round(Number(amountUsd) * 100) / 100;
    if (!(requestedValue > 0)) throw new Error('INVALID_AMOUNT');
    if (requestedValue < MIN_TRADE_USD) throw new Error('MIN_TRADE_USD');
    if (requestedValue > MAX_TRADE_USD) throw new Error('MAX_TRADE_USD');

    feeUsd = requestedValue * FEE_RATE;
    slippageUsd = requestedValue * SLIPPAGE_RATE;
    const totalCost = requestedValue + feeUsd;
    if (account.cashBalance < totalCost - 1e-6) throw new Error('INSUFFICIENT_BALANCE');

    quantity = requestedValue / executionPrice;
    cashAfter = account.cashBalance - totalCost;
  } else {
    // SELL
    const position = get('SELECT * FROM positions WHERE account_id = ? AND chain_id = ? AND address = ?', [
      account.id, chainId, address,
    ]);
    if (!position || !(position.quantity > 0)) throw new Error('NO_POSITION');

    if (percent !== undefined) {
      const pct = Number(percent);
      if (!(pct > 0 && pct <= 100)) throw new Error('INVALID_PERCENT');
      quantity = position.quantity * (pct / 100);
    } else {
      requestedValue = Math.round(Number(amountUsd) * 100) / 100;
      if (!(requestedValue > 0)) throw new Error('INVALID_AMOUNT');
      quantity = requestedValue / executionPrice;
      if (quantity > position.quantity * 1.000001) throw new Error('INSUFFICIENT_POSITION');
    }
    quantity = Math.min(quantity, position.quantity);

    requestedValue = quantity * executionPrice;
    feeUsd = requestedValue * FEE_RATE;
    slippageUsd = requestedValue * SLIPPAGE_RATE;
    proceeds = requestedValue - feeUsd;
    cashAdd = proceeds;
    cashAfter = account.cashBalance + cashAdd;
  }

  const tradeId = crypto.randomUUID();
  const totalUsd = side === 'BUY' ? requestedValue : requestedValue;

  // Insert the trade.
  run(
    'INSERT INTO trades (id, account_id, chain_id, address, symbol, side, quantity, execution_price, market_price, ' +
    'requested_value_usd, fee_usd, slippage_usd, cash_after, liquidity_usd, market_cap_usd, status, timestamp, total_usd, cycle_id, client_request_id) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      tradeId, account.id, chainId, address, symbol, side, quantity, executionPrice, priceUsd,
      requestedValue, feeUsd, slippageUsd, cashAfter,
      quote.liquidityUsd ?? null, quote.marketCapUsd ?? null, 'open', timestamp, totalUsd,
      null, clientRequestId,
    ]
  );

  // Update or create position.
  const existing = get('SELECT * FROM positions WHERE account_id = ? AND chain_id = ? AND address = ?', [
    account.id, chainId, address,
  ]);

  let position, closesPosition = false;
  let cycleId = existing ? existing.cycle_id : crypto.randomUUID();

  if (side === 'BUY') {
    if (existing) {
      const newQty = existing.quantity + quantity;
      const newCostBasis = existing.cost_basis + requestedValue;
      run(
        'UPDATE positions SET quantity = ?, average_entry_price = ?, cost_basis = ?, updated_at = ? WHERE id = ?',
        [newQty, newCostBasis / newQty, newCostBasis, timestamp, existing.id]
      );
      position = { ...existing, quantity: newQty, averageEntryPrice: newCostBasis / newQty, costBasis: newCostBasis, cycleId: existing.cycle_id };
    } else {
      run(
        'INSERT INTO positions (id, account_id, chain_id, address, symbol, quantity, average_entry_price, cost_basis, ' +
        'entry_market_cap_usd, opened_at, cycle_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), account.id, chainId, address, symbol, quantity, executionPrice, requestedValue,
         quote.marketCapUsd ?? null, timestamp, cycleId]
      );
      position = { assetId: cycleId, chainId, address, symbol, quantity, averageEntryPrice: executionPrice,
        costBasis: requestedValue, entryMarketCapUsd: quote.marketCapUsd ?? null, openedAt: timestamp, cycleId };
    }
  } else {
    const avgEntry = existing.average_entry_price;
    const costRemoved = avgEntry * quantity;
    const remainingQty = existing.quantity - quantity;
    const newCostBasis = existing.cost_basis - costRemoved;

    if (remainingQty <= 1e-6) {
      // Full close -> closed trade.
      const entryPrice = avgEntry;
      const exitPrice = executionPrice;
      const positionSizeUsd = existing.cost_basis;
      const realizedPnl = (exitPrice - entryPrice) * quantity - feeUsd;
      const returnPct = positionSizeUsd > 0 ? (realizedPnl / positionSizeUsd) * 100 : 0;
      const holdMs = timestamp - existing.opened_at;

      run(
        'INSERT INTO closed_trades (id, account_id, chain_id, address, symbol, entry_price, exit_price, ' +
        'entry_market_cap_usd, exit_market_cap_usd, position_size_usd, proceeds_usd, fees_usd, realized_pnl_usd, ' +
        'return_pct, buy_count, sell_count, hold_ms, entry_time, exit_time, cycle_id, asset_id) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          crypto.randomUUID(), account.id, chainId, address, symbol, entryPrice, exitPrice,
          existing.entry_market_cap_usd, quote.marketCapUsd ?? null, positionSizeUsd, requestedValue, feeUsd,
          realizedPnl, returnPct, 1, 1, holdMs, existing.opened_at, timestamp, existing.cycle_id, existing.cycle_id,
        ]
      );
      run('DELETE FROM positions WHERE id = ?', [existing.id]);
      closesPosition = true;
      position = null;
    } else {
      run(
        'UPDATE positions SET quantity = ?, cost_basis = ?, updated_at = ? WHERE id = ?',
        [remainingQty, newCostBasis, timestamp, existing.id]
      );
      position = {
        ...existing, quantity: remainingQty, costBasis: newCostBasis, cycleId: existing.cycle_id,
      };
    }
  }

  run('UPDATE accounts SET cash_balance = ?, updated_at = ? WHERE id = ?', [cashAfter, timestamp, account.id]);

  const trade = tradeRowToTrade({
    id: tradeId, chain_id: chainId, address, symbol, side, quantity, execution_price: executionPrice,
    market_price: priceUsd, requested_value_usd: requestedValue, fee_usd: feeUsd, slippage_usd: slippageUsd,
    cash_after: cashAfter, liquidity_usd: quote.liquidityUsd, market_cap_usd: quote.marketCapUsd,
    status: closesPosition ? 'closed' : 'open', timestamp, total_usd: totalUsd, cycle_id: cycleId,
    client_request_id: clientRequestId,
  });
  trade.closesPosition = closesPosition;

  return { trade, account: { ...account, cashBalance: cashAfter }, position };
}

/** Close an entire open position (sell 100%). */
export function closePosition(userId, { chainId, address, clientRequestId, quote }) {
  return placeTrade(userId, { chainId, address, symbol: '', side: 'SELL', percent: 100, clientRequestId, quote });
}

/** Portfolio snapshot: account + positions (with live quotes) + performance. */
export async function getPortfolio(userId, tzOffset = 0) {
  const acctRow = get('SELECT * FROM accounts WHERE user_id = ?', [userId]);
  if (!acctRow) throw new Error('ACCOUNT_NOT_FOUND');
  if (acctRow.needs_setup === 1) throw new Error('ACCOUNT_SETUP_REQUIRED');

  const account = {
    id: acctRow.id, userId: acctRow.user_id, cashBalance: acctRow.cash_balance,
    startingBalance: acctRow.starting_balance, needsSetup: false,
    createdAt: acctRow.created_at, updatedAt: acctRow.updated_at,
  };

  const rows = all('SELECT * FROM positions WHERE account_id = ? ORDER BY opened_at DESC', [account.id]);
  const positions = [];
  let marketValue = 0;

  // Fetch live quotes for every open position in one batch request (telemetry.io).
  const quoteMap = await fetchQuotesBatch(
    rows.map((r) => r.address)
  ).catch(() => ({}));

  rows.forEach((row) => {
    const pos = positionRowToPosition(row);
    const q = quoteMap[row.address];
    if (q) {
      pos.currentPrice = q.priceUsd;
      pos.marketCapUsd = q.marketCapUsd;
      pos.symbol = q.symbol || pos.symbol;
    } else {
      pos.currentPrice = pos.averageEntryPrice;
      pos.marketCapUsd = row.entry_market_cap_usd;
    }
    pos.unrealizedPnl = (pos.currentPrice - pos.averageEntryPrice) * pos.quantity;
    pos.unrealizedPnlPct = pos.averageEntryPrice > 0
      ? ((pos.currentPrice - pos.averageEntryPrice) / pos.averageEntryPrice) * 100
      : 0;
    pos.marketValue = pos.quantity * pos.currentPrice;
    marketValue += pos.marketValue;
    positions.push(pos);
  });

  const startingBalance = account.startingBalance;
  const totalEquity = account.cashBalance + marketValue;
  const totalPnl = totalEquity - startingBalance;
  const totalPnlPct = startingBalance > 0 ? (totalPnl / startingBalance) * 100 : 0;

  const invested = positions.reduce((s, p) => s + p.costBasis, 0);
  const openPositionCount = positions.length;

  // Today's realized PnL (closed trades started today, local tz).
  const startOfDay = new Date();
  startOfDay.setUTCHours(-tzOffset, 0, 0, 0); // normalize to local midnight
  const dayStartMs = startOfDay.getTime();

  const trades = all('SELECT * FROM trades WHERE account_id = ? ORDER BY timestamp DESC', [account.id]);
  const closed = all('SELECT * FROM closed_trades WHERE account_id = ? ORDER BY exit_time DESC', [account.id]);

  const todayPnl = closed
    .filter((t) => t.exit_time >= dayStartMs)
    .reduce((s, t) => s + t.realized_pnl_usd, 0);

  const wins = closed.filter((t) => t.realized_pnl_usd > 0).length;
  const losses = closed.filter((t) => t.realized_pnl_usd < 0).length;
  const decided = wins + losses;
  const winRate = decided > 0 ? (wins / decided) * 100 : null;

  const tradeCount = trades.length;
  const buyCount = trades.filter((t) => t.side === 'BUY').length;
  const sellCount = trades.filter((t) => t.side === 'SELL').length;

  const bestTrade = closed.length
    ? closed.reduce((b, t) => (t.realized_pnl_usd > b.realized_pnl_usd ? t : b), closed[0])
    : null;

  // ---- Trading style / coaching metrics ----
  const closedWithReturn = closed.filter((t) => t.return_pct != null);
  const sampleSize = closed.length;
  const grossProfit = closed.filter((t) => t.realized_pnl_usd > 0).reduce((s, t) => s + t.realized_pnl_usd, 0);
  const grossLoss = closed.filter((t) => t.realized_pnl_usd < 0).reduce((s, t) => s + Math.abs(t.realized_pnl_usd), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null;
  const expectancyUsd = closed.length > 0
    ? closed.reduce((s, t) => s + t.realized_pnl_usd, 0) / closed.length
    : null;
  const averageWinUsd = wins > 0 ? grossProfit / wins : null;
  const averageLossUsd = losses > 0 ? -grossLoss / losses : null;
  const averageBuySizeUsd = buyCount > 0
    ? trades.filter((t) => t.side === 'BUY').reduce((s, t) => s + t.requested_value, 0) / buyCount
    : null;
  const averageBuyPctOfCash = startingBalance > 0 && averageBuySizeUsd != null
    ? (averageBuySizeUsd / startingBalance) * 100
    : null;

  const holdMsList = closed.map((t) => t.hold_ms).filter((v) => v != null && v > 0).sort((a, b) => a - b);
  const medianHoldMs = holdMsList.length
    ? holdMsList[Math.floor((holdMsList.length - 1) / 2)]
    : null;

  const bestReturnPct = closedWithReturn.length
    ? Math.max(...closedWithReturn.map((t) => t.return_pct))
    : null;

  const maxRealizedDrawdownPct = sampleSize > 0 ? calculateDrawdownPct(closed) : null;

  // Activity by hour (UTC), last 200 trades.
  const activityByHourUtc = new Array(24).fill(0);
  trades.slice(0, 200).forEach((t) => {
    const h = new Date(t.timestamp).getUTCHours();
    activityByHourUtc[h] += 1;
  });

  const style = sampleSize >= 5 ? classifyStyle(medianHoldMs, winRate, profitFactor) : null;
  const styleDescription = styleDescriptionText(style, medianHoldMs, winRate);

  const insights = buildInsights({ medianHoldMs, winRate, profitFactor, expectancyUsd, bestReturnPct, maxRealizedDrawdownPct });

  const performance = {
    cash: account.cashBalance,
    totalEquity,
    totalPnl,
    totalPnlPct,
    startingBalance,
    marketValue,
    invested,
    openPositionCount,
    todayPnl,
    wins,
    losses,
    winRate: winRate ?? null,
    tradeCount,
    buyCount,
    sellCount,
    bestTrade: bestTrade ? closedRowToClosed(bestTrade) : null,
  };

  const tradingStyle = {
    sampleSize,
    style,
    styleDescription,
    activityByHourUtc,
    personalBests: { bestReturnPct: bestReturnPct ?? null },
    medianHoldMs: medianHoldMs ?? null,
    winRatePct: winRate ?? null,
    profitFactor: profitFactor ?? null,
    expectancyUsd: expectancyUsd ?? null,
    averageWinUsd: averageWinUsd ?? null,
    averageLossUsd: averageLossUsd ?? null,
    averageBuySizeUsd: averageBuySizeUsd ?? null,
    averageBuyPctOfCash: averageBuyPctOfCash ?? null,
    maxRealizedDrawdownPct: maxRealizedDrawdownPct ?? null,
    insights,
  };

  return {
    account,
    performance,
    positions,
    trades: trades.map(tradeRowToTrade),
    closedTrades: closed.map(closedRowToClosed),
    tradingStyle,
  };
}

/** Trade history list with optional filters. */
export function getTrades(userId, { side, asset, from, to, scope = 'current', limit = 200 } = {}) {
  const acctRow = get('SELECT id FROM accounts WHERE user_id = ?', [userId]);
  if (!acctRow) throw new Error('ACCOUNT_NOT_FOUND');

  let sql = 'SELECT * FROM trades WHERE account_id = ?';
  const params = [acctRow.id];

  if (side) { sql += ' AND side = ?'; params.push(side); }
  if (asset) {
    const [chain, address] = asset.split(':');
    sql += ' AND chain_id = ? AND address = ?';
    params.push(chain, address);
  }
  if (from) { sql += ' AND timestamp >= ?'; params.push(Number(from)); }
  if (to) { sql += ' AND timestamp <= ?'; params.push(Number(to)); }
  sql += ' ORDER BY timestamp DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }

  const rows = all(sql, params);
  return { trades: rows.map(tradeRowToTrade) };
}

/** Closed trades list. */
export function getClosedTrades(userId) {
  const acctRow = get('SELECT id FROM accounts WHERE user_id = ?', [userId]);
  if (!acctRow) throw new Error('ACCOUNT_NOT_FOUND');
  const rows = all('SELECT * FROM closed_trades WHERE account_id = ? ORDER BY exit_time DESC', [acctRow.id]);
  return { closedTrades: rows.map(closedRowToClosed) };
}

/** Full export of a user's paper data (JSON or CSV rows). */
export function exportUserData(userId, format = 'json') {
  const acctRow = get('SELECT * FROM accounts WHERE user_id = ?', [userId]);
  if (!acctRow) throw new Error('ACCOUNT_NOT_FOUND');

  const account = {
    id: acctRow.id, userId: acctRow.user_id, cashBalance: acctRow.cash_balance,
    startingBalance: acctRow.starting_balance, needsSetup: acctRow.needs_setup === 1,
    createdAt: acctRow.created_at, updatedAt: acctRow.updated_at,
  };

  const positions = all('SELECT * FROM positions WHERE account_id = ?', [account.id]).map(positionRowToPosition);
  const trades = all('SELECT * FROM trades WHERE account_id = ? ORDER BY timestamp DESC', [account.id]).map(tradeRowToTrade);
  const closed = all('SELECT * FROM closed_trades WHERE account_id = ? ORDER BY exit_time DESC', [account.id]).map(closedRowToClosed);
  const profile = get('SELECT * FROM profiles WHERE user_id = ?', [userId]);

  if (format === 'csv') {
    const lines = ['id,account_id,chain_id,address,symbol,side,quantity,execution_price,market_price,requested_value_usd,fee_usd,slippage_usd,cash_after,status,timestamp,total_usd,cycle_id'];
    for (const t of trades) {
      lines.push([t.id, t.chainId, t.address, t.symbol, t.side, t.quantity, t.executionPrice, t.marketPrice,
        t.requestedValue, t.fee, t.slippage, t.cashAfter, t.status, t.timestamp, t.total, t.cycleId].join(','));
    }
    return { text: lines.join('\n'), filename: `paper-trades-${userId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`, contentType: 'text/csv' };
  }

  return {
    text: JSON.stringify({ account, positions, trades, closedTrades: closed, profile }, null, 2),
    filename: `paper-account-${userId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`,
    contentType: 'application/json',
  };
}

/** Update profile (display name / photo url). */
export function updateProfile(userId, { displayName, photoUrl }) {
  const existing = get('SELECT user_id FROM profiles WHERE user_id = ?', [userId]);
  const nowTs = now();
  if (existing) {
    const sets = [];
    const vals = [];
    if (displayName !== undefined) { sets.push('display_name = ?'); vals.push(displayName); }
    if (photoUrl !== undefined) { sets.push('photo_url = ?'); vals.push(photoUrl); }
    if (sets.length) {
      sets.push('updated_at = ?'); vals.push(nowTs);
      vals.push(userId);
      run(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`, vals);
    }
  } else {
    run(
      'INSERT INTO profiles (user_id, display_name, photo_url, updated_at) VALUES (?, ?, ?, ?)',
      [userId, displayName ?? null, photoUrl ?? null, nowTs]
    );
  }
  const row = get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
  return {
    user: {
      id: userId,
      displayName: row.display_name || null,
      photoUrl: row.photo_url || null,
    },
  };
}

/** Accept consent (terms / age). No-op on server, recorded so we can extend later. */
export function recordConsent(userId) {
  // Consent is a UI gate in the extension. We just acknowledge it.
  return { ok: true };
}

/** Delete a user's account and all paper data. */
export function deleteAccountAndData(userId) {
  run('DELETE FROM closed_trades WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)', [userId]);
  run('DELETE FROM trades WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)', [userId]);
  run('DELETE FROM positions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)', [userId]);
  run('DELETE FROM accounts WHERE user_id = ?', [userId]);
  run('DELETE FROM profiles WHERE user_id = ?', [userId]);
  return { ok: true };
}

/* -------------------- helpers -------------------- */

function calculateDrawdownPct(closed) {
  if (!closed.length) return null;
  let peak = 0;
  let trough = 0;
  let running = 0;
  let maxDD = 0;
  // Order by exit time to simulate equity curve over closed trades.
  const ordered = [...closed].sort((a, b) => a.exit_time - b.exit_time);
  for (const t of ordered) {
    running += t.realized_pnl_usd;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > trough) trough = dd;
  }
  return peak > 0 ? (trough / peak) * 100 : 0;
}

function classifyStyle(medianHoldMs, winRate, profitFactor) {
  if (!medianHoldMs) return 'New';
  const hours = medianHoldMs / (1000 * 60 * 60);
  if (hours < 1) return 'Scalper';
  if (hours < 24) return 'Day trader';
  return 'Swing trader';
}

function styleDescriptionText(style, medianHoldMs, winRate) {
  if (!style) return 'Not enough closed trades yet.';
  if (style === 'Scalper') return 'You open and close positions quickly, often within minutes or hours.';
  if (style === 'Day trader') return 'You hold positions for hours but typically flat by the end of the day.';
  return 'You hold positions for days or longer, riding bigger swings.';
}

function buildInsights({ medianHoldMs, winRate, profitFactor, expectancyUsd, bestReturnPct, maxRealizedDrawdownPct }) {
  const insights = [];
  if (winRate != null) {
    insights.push(winRate >= 50
      ? `You win ${winRate.toFixed(0)}% of decided trades — above even money.`
      : `Your win rate is ${winRate.toFixed(0)}%. Focus on cutting losers faster.`);
  }
  if (expectancyUsd != null) {
    insights.push(expectancyUsd > 0
      ? `Average result per trade: ${expectancyUsd > 0 ? '+' : ''}$${expectancyUsd.toFixed(2)} per trade.`
      : `Average result per trade is negative — review your entry sizing.`);
  }
  if (medianHoldMs) {
    const h = medianHoldMs / (1000 * 60 * 60);
    const holdText = h < 1 ? `${Math.round(medianHoldMs / 60000)} min` : `${h.toFixed(1)} h`;
    insights.push(`Your median hold is ${holdText}.`);
  }
  if (profitFactor != null && Number.isFinite(profitFactor)) {
    insights.push(`Profit factor: ${profitFactor.toFixed(2)} (gross profit over gross loss).`);
  }
  if (bestReturnPct != null) {
    insights.push(`Best trade returned ${bestReturnPct.toFixed(2)}%.`);
  }
  if (maxRealizedDrawdownPct != null) {
    insights.push(`Max realized drawdown: ${maxRealizedDrawdownPct.toFixed(2)}%.`);
  }
  if (insights.length === 0) insights.push('Keep trading to unlock your style read.');
  return insights;
}
