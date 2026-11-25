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
import { saveTelegramMessage } from '../db.js';

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
        connecting = false;
        return { ok: false, message: lastError };
      }

      console.log('[telegram-client] Starting authentication for', phone);
      await client.sendCode({ apiId, apiHash }, phone);
      console.log('[telegram-client] Code sent. Set TELEGRAM_CODE env var and restart, or use the auth endpoint.');

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
          const chatUsername = chat?.username || '';
          const chatIdStr = chatId;
          const isMonitored = monitoredChannels.some((ch) =>
            ch === chatUsername || ch === chatIdStr || ch === chatTitle
          );
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

        const record = {
          id: `${chatId}_${msg.id}`,
          chatId,
          chatTitle,
          senderId,
          senderName,
          text: msg.text || msg.message || '',
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
        console.log(`[telegram-client] Message from ${chatTitle}: ${(record.text || '').slice(0, 80)}`);
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