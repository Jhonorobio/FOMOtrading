/**
 * Telegram — shared helpers to notify new graduated tokens.
 * Extracted from index.js so more than one feed (Mobula now, Photon Graduados
 * later) can reuse the same bot, the same message template and the same logs.
 */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

export function formatMarketCap(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

/** Envía un mensaje a Telegram. Devuelve true si el envío triunfó, false si falló
 * (incluido bot no configurado) — el que llama decide si reintentar o hacer rollback. */
export async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[telegram] not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the server .env');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[telegram] sendMessage failed:', res.status, body.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    // silencioso: no debe romper el ciclo que llama, pero dejamos rastro en el log
    console.error('[telegram] sendMessage error:', err?.message ?? err);
    return false;
  }
}

/** Mensaje de "nuevo graduado". `title` permite distinguir el feed de origen. */
export function graduateMessage(t, title = 'Nuevo token en Graduados') {
  return `🚀 <b>${title}</b>\n` +
    `Symbol: ${t.symbol}\n` +
    `Name: ${t.name}\n` +
    `Address: <code>${t.address}</code>\n` +
    `Security Score: ${t.securityScore ?? '—'} | Holders: ${t.holders ?? '—'} | MK: ${formatMarketCap(t.marketCap)}\n` +
    `<a href="https://fomo.family/tokens/${t.chainId}/${t.address}">FOMO</a> | ` +
    `<a href="https://gmgn.ai/sol/token/${t.address}">GMGN</a> | ` +
    `<a href="https://photon-sol.tinyastro.io/en/lp/${t.address}">PHOTON</a> | ` +
    `<a href="paper-terminal://trade/${t.chainId}:${t.address}">App</a>`;
}
