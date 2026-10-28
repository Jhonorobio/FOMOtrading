/**
 * Minimal .env loader (no extra dependency). Reads server/.env into process.env
 * for values not already defined. Must be imported before anything that reads env vars.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadEnv() {
  try {
    const envPath = join(process.cwd(), '.env');
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes.
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env file: rely on environment variables already set (e.g. on Railway).
  }
}

loadEnv();
