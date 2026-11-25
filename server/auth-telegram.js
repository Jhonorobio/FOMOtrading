/**
 * Standalone Telegram authentication script.
 *
 * Usage:
 *   1. Set env vars: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE
 *   2. Run: node auth-telegram.js
 *   3. Enter the code you receive in Telegram
 *   4. Copy the session string printed at the end
 *   5. Set TELEGRAM_SESSION=<string> in your .env or Railway env vars
 *
 * The session is also saved to data/telegram-session.txt automatically.
 */
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
  const phone = process.env.TELEGRAM_PHONE;

  if (!apiId || !apiHash) {
    console.error('ERROR: Set TELEGRAM_API_ID and TELEGRAM_API_HASH env vars first.');
    console.error('Get them from https://my.telegram.org -> API development tools');
    process.exit(1);
  }
  if (!phone) {
    console.error('ERROR: Set TELEGRAM_PHONE env var (with country code, e.g. +54911...)');
    process.exit(1);
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
  await client.sendCode({ apiId, apiHash }, phone);

  const code = await ask('Enter the code you received: ');
  const password = process.env.TELEGRAM_2FA_PASSWORD || (await ask('Enter 2FA password (or leave empty): '));

  try {
    await client.signIn({ apiId, apiHash }, phone, code, async () => password);
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
  console.log('Also saved to data/telegram-session.txt');

  // Save to file
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, 'telegram-session.txt'), sessionStr, 'utf8');

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});