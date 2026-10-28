// Market data for the target terminal's assets comes from the paper server's
// provider (DexScreener public API) - never from FOMO's private trading APIs.
import { api } from '../../services/api.js';

export async function fetchQuote(asset) {
  const { quote } = await api.quote(asset);
  return quote;
}
