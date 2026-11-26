/**
 * Standalone Telegram authentication script.
 *
 * Usage:
 *   1. Set env vars: TELEGRAM_API_ID, TELEGRAM_API_HASH (or in .env)
 *   2. Run: node auth-telegram.js
 *   3. Enter your phone number, the code you receive, and 2FA password if needed
 *   4. Copy the session string printed at the end
 *   5. Set TELEGRAM_SESSION=<string> in your .env or Railway env vars
 */
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Load .env file
try {
  const { readFileSync } = await import('node:fs');
  const envPath = join(process.cwd(), '.env');
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {}

const DATA_DIR = join(process.cwd(), 'data');

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiId || !apiHash) {
    console.error('ERROR: Set TELEGRAM_API_ID and TELEGRAM_API_HASH env vars first.');
    console.error('Get them from https://my.telegram.org -> API development tools');
    process.exit(1);
  }

  let phone = process.env.TELEGRAM_PHONE;
  if (!phone) {
    phone = await ask('Enter your phone number (with country code, e.g. +573107424776): ');
    if (!phone) {
      console.error('ERROR: Phone number is required.');
      process.exit(1);
    }
  }

  console.log('Connecting to Telegram...');
  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true,
  });

  await client.connect();

  if (await client.checkAuthorization()) {
    console.log('Already authorized! Session string:');
    console.log(client.session.save());
    await client.disconnect();
    return;
  }

  console.log('Sending code to', phone, '...');
  try {
    const user = await client.signInUser(
      { apiId, apiHash },
      {
        phoneNumber: phone,
        phoneCode: async () => {
          console.log('Code sent! Check your Telegram app or SMS.');
          return await ask('Enter the code you received: ');
        },
        password: async () => {
          const pwd = process.env.TELEGRAM_2FA_PASSWORD;
          if (pwd) return pwd;
          const input = await ask('Enter 2FA password (or leave empty): ');
          return input || '';
        },
        onError: async (err) => {
          console.error('Auth error:', err.message);
          return false; // don't retry
        },
      }
    );
    console.log('Signed in as:', user?.firstName || user?.username || 'OK');
  } catch (err) {
    console.error('Sign in failed:', err.message);
    await client.disconnect();
    process.exit(1);
  }

  const sessionStr = client.session.save();
  console.log('\n========================================');
  console.log('SUCCESS! Session string:');
  console.log(sessionStr);
  console.log('========================================\n');
  console.log('Save this as TELEGRAM_SESSION in your .env or Railway env vars.');

  // Save to file
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, 'telegram-session.txt'), sessionStr, 'utf8');
  console.log('Also saved to data/telegram-session.txt');

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});