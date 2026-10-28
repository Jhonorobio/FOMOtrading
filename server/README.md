# Paper Terminal — self-hosted server

Replacement backend for the Paper Terminal Chrome extension (fomo.family paper trading).
Runs locally and deploys to Railway.

## Run locally

```bash
cd server
cp .env.example .env
# edit .env (at least JWT_SECRET)
npm install
npm start
```

The server listens on `http://localhost:3001` (or `$PORT`).

Point the extension at it: in `src/config.js` set
`DEFAULT_SERVER_URL = 'http://localhost:3001'`, or set `devServerUrl` in
`chrome.storage.local` from the DevTools console.

## Deploy to Railway

1. Push this folder to a Git repo.
2. Create a new Railway service from the repo.
3. Add the environment variables from `.env` (copy `.env.example` values, change `JWT_SECRET`).
4. Railway will run `npm start`. The service is reachable at its Railway URL — set that as the extension's server URL.

## Database

SQLite file at `server/data/paper.db`. For Railway, attach a persistent volume
or switch to PostgreSQL if you prefer.

## Auth

Personal access code only (no Google OAuth). The server accepts codes `FOMO`
or `fomo` and unlocks a single personal account (`personal@paper.local`).

- `POST /api/auth/code` with `{ code: "FOMO" }` → returns session token.

## Market data

Two providers available:

| Provider | Setup | Notes |
|----------|-------|-------|
| **telemetry.io** (recommended) | Set `TELEMETRY_BEARER_TOKEN` in `.env` | Live prices, batch-capable, faster updates |
| **DexScreener** (fallback) | No key needed | Public API, slower (~12-14s updates) |

When `TELEMETRY_BEARER_TOKEN` is set, the server uses telemetry.io as the
primary source and falls back to DexScreener on failure. When unset, it uses
DexScreener only.

Get your Bearer token from `app.telemetry.io` (Network tab →
`/data/market_data_batch` → `Authorization: Bearer <token>`).

## API endpoints

See `server/src/index.js` for the full route list. Key endpoints:

- `GET /api/health` — server status
- `GET /api/config` — trading config + active market data provider
- `GET /api/quote?chain=solana&address=<mint>` — live quote for a token
- `POST /api/auth/code` — unlock personal account with access code
- `POST /api/account/start` — create account with starting capital
- `POST /api/trades` — place a simulated trade (BUY/SELL)
- `POST /api/positions/close` — close an open position
- `GET /api/portfolio` — account + positions + performance
- `GET /api/export?format=json\|csv` — export trading history
