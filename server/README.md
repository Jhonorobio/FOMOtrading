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

- Google sign-in: set `GOOGLE_CLIENT_ID` in `.env`.
- Developer sign-in (no Google): `POST /api/auth/dev` with `{ email, name }` —
  always enabled, useful for local testing.
