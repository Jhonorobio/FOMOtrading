import initSqlJs from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'paper.db');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

let SQL;
let db;
let initialized = false;

const SCHEMA = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    photo_url TEXT,
    google_sub TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id),
    cash_balance REAL NOT NULL DEFAULT 0,
    starting_balance REAL NOT NULL DEFAULT 0,
    needs_setup INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    chain_id TEXT NOT NULL,
    address TEXT NOT NULL,
    symbol TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    average_entry_price REAL NOT NULL DEFAULT 0,
    cost_basis REAL NOT NULL DEFAULT 0,
    entry_market_cap_usd REAL,
    opened_at INTEGER NOT NULL,
    cycle_id TEXT NOT NULL,
    UNIQUE(account_id, chain_id, address)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    chain_id TEXT NOT NULL,
    address TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity REAL NOT NULL,
    execution_price REAL NOT NULL,
    market_price REAL NOT NULL,
    requested_value_usd REAL NOT NULL,
    fee_usd REAL NOT NULL DEFAULT 0,
    slippage_usd REAL NOT NULL DEFAULT 0,
    cash_after REAL NOT NULL,
    liquidity_usd REAL,
    market_cap_usd REAL,
    status TEXT NOT NULL DEFAULT 'open',
    timestamp INTEGER NOT NULL,
    total_usd REAL NOT NULL,
    cycle_id TEXT,
    client_request_id TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS closed_trades (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    chain_id TEXT NOT NULL,
    address TEXT NOT NULL,
    symbol TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    entry_market_cap_usd REAL,
    exit_market_cap_usd REAL,
    position_size_usd REAL NOT NULL,
    proceeds_usd REAL NOT NULL,
    fees_usd REAL NOT NULL DEFAULT 0,
    realized_pnl_usd REAL NOT NULL,
    return_pct REAL NOT NULL,
    buy_count INTEGER NOT NULL DEFAULT 0,
    sell_count INTEGER NOT NULL DEFAULT 0,
    hold_ms INTEGER NOT NULL DEFAULT 0,
    entry_time INTEGER NOT NULL,
    exit_time INTEGER NOT NULL,
    cycle_id TEXT,
    asset_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    display_name TEXT,
    photo_url TEXT,
    updated_at INTEGER NOT NULL
  );
`;

export async function initDb() {
  SQL = await initSqlJs();
  if (existsSync(DB_PATH)) {
    try {
      db = new SQL.Database(readFileSync(DB_PATH));
    } catch {
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }
  db.exec(SCHEMA);
  initialized = true;
  return db;
}

function requireDb() {
  if (!initialized || !db) throw new Error('Database not initialized');
  return db;
}

let dirty = false;

function saveDb() {
  try {
    if (!db) return;
    writeFileSync(DB_PATH, Buffer.from(db.export()));
    dirty = false;
  } catch (err) {
    console.error('[db] failed to persist', err);
  }
}

setInterval(saveDb, 30000);
process.on('exit', () => saveDb());
process.on('SIGINT', () => { saveDb(); process.exit(0); });
process.on('SIGTERM', () => { saveDb(); process.exit(0); });

/** Embed bind parameters into SQL safely (values are server-controlled, but we still escape quotes). */
function embedParam(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function embedParams(sql, params) {
  let i = 0;
  return sql.replace(/\?/g, () => embedParam(params[i++]));
}

function rowsToObjects(columns, values) {
  return values.map((row) => {
    const obj = {};
    for (let i = 0; i < columns.length; i++) obj[columns[i]] = row[i];
    return obj;
  });
}

export function run(sql, params = []) {
  const d = requireDb();
  dirty = true;
  const stmt = d.prepare(sql);
  const info = stmt.run(params);
  stmt.free();
  return info;
}

export function all(sql, params = []) {
  const d = requireDb();
  const result = d.exec(embedParams(sql, params));
  if (!result || !result.length) return [];
  return rowsToObjects(result[0].columns, result[0].values);
}

export function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

export function exec(sql) {
  const d = requireDb();
  d.exec(sql);
  dirty = true;
}
