/**
 * Telegram authentication using GramJS (telegram package).
 * Usage: node auth-telegram-gramjs.js
 */
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Load .env
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

  console.log('Connecting to Telegram with GramJS...');
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
  const { phoneCodeHash } = await client.sendCode(
    { apiId, apiHash },
    phone
  );
  console.log('Code sent! (isCodeViaApp: check your Telegram app)');

  const code = await ask('Enter the code you received: ');
  const password = process.env.TELEGRAM_2FA_PASSWORD || await ask('Enter 2FA password (or leave empty): ');

  try {
    await client.signIn(
      { apiId, apiHash },
      phone,
      { phoneCode: code, phoneCodeHash, password: password || undefined }
    );
    console.log('Signed in successfully');
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