// Thin client used by the overlay and side panel. All traffic goes through the background worker.

export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

async function send(message) {
  let response;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch {
    throw new ApiError({ status: 0, code: 'EXTENSION_RELOADED', message: 'The extension was updated. Refresh this page.' });
  }
  if (!response) throw new ApiError({ status: 0, code: 'NO_RESPONSE', message: 'No response from the extension.' });
  if (!response.ok) {
    // An older background worker (extension not reloaded after an update) rejects newer requests.
    if (response.error?.code === 'BAD_REQUEST') {
      throw new ApiError({
        ...response.error,
        code: 'EXTENSION_OUTDATED',
        message: 'Paper Terminal was updated. Open chrome://extensions, click ↻ on Paper Terminal, then try again.',
      });
    }
    throw new ApiError(response.error);
  }
  return response.data;
}

const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return s ? `?${s}` : '';
};

export const api = {
  tokens: () => send({ type: 'api', method: 'GET', path: '/api/tokens' }),
  config: () => send({ type: 'api', method: 'GET', path: '/api/config' }),
  me: () => send({ type: 'api', method: 'GET', path: '/api/me' }),
  quote: (asset) => send({ type: 'api', method: 'GET', path: `/api/quote${qs({ chain: asset.chain, address: asset.address })}` }),
  tokenLogo: (chain, address) => send({ type: 'api', method: 'GET', path: `/api/token-logo${qs({ chain, address })}` }),
  priceHistory: (chain, address, from, to) => send({ type: 'api', method: 'GET', path: `/api/price-history${qs({ chain, address, from, to })}` }),
  assetState: (asset) => send({ type: 'api', method: 'GET', path: `/api/asset-state${qs({ chain: asset.chain, address: asset.address })}` }),
  portfolio: () => send({ type: 'api', method: 'GET', path: `/api/portfolio${qs({ tzOffset: new Date().getTimezoneOffset() })}` }),
  trades: (filters = {}) => send({ type: 'api', method: 'GET', path: `/api/trades${qs(filters)}` }),
  closedTrades: (filters = {}) => send({ type: 'api', method: 'GET', path: `/api/closed-trades${qs(filters)}` }),
  trade: (body) => send({ type: 'api', method: 'POST', path: '/api/trades', body }),
  closePosition: (body) => send({ type: 'api', method: 'POST', path: '/api/positions/close', body }),
  consent: (body) => send({ type: 'api', method: 'POST', path: '/api/consent', body }),
  deleteAccount: () => send({ type: 'api', method: 'POST', path: '/api/account/delete' }),
  updateProfile: (body) => send({ type: 'api', method: 'POST', path: '/api/profile', body }),
  startAccount: (startingBalance) => send({ type: 'api', method: 'POST', path: '/api/account/start', body: { startingBalance } }),
  resetAccount: (startingBalance) => send({ type: 'api', method: 'POST', path: '/api/account/reset', body: { startingBalance } }),
  export: (format) => send({ type: 'export', format }),
  signInWithCode: (code) => send({ type: 'auth:code', code }),
  signOut: () => send({ type: 'auth:signout' }),
  openSidePanel: () => send({ type: 'open-sidepanel' }),
};
