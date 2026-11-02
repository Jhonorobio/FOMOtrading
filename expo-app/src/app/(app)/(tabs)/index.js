// TRADE TAB — replica of the side panel Trade view (asset strip + src/components/trade-panel.js).
// On mobile there is no fomo.family page to read, so the token is entered manually:
// fomo.family link, DexScreener link, or `chain:address`.
import { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError, getServerUrl } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { C } from '../../../lib/theme';
import {
  formatUsd, formatPrice, formatCompactQty, formatSignedUsd, formatPct,
  parseTokenRef, shortAddr, formatAge,
} from '../../../lib/format';
import { Screen, Box, Notice } from '../../../components/ui';
import Avatar from '../../../components/Avatar';

const POLL_MS = 500;
const DEFAULT_BUY = [10, 100, 500, 1000];
const DEFAULT_SELL = [25, 50, 75, 100];
const FEE_RATE = 0.001;

export default function TradeScreen() {
  const { me, meLoaded, setMe } = useSession();

  return (
    <Screen title="Trade">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {meLoaded && me?.account == null && me.needsSetup ? (
          <SetupPanel />
        ) : (
          <TradePanel me={me} setMe={setMe} />
        )}
      </ScrollView>
    </Screen>
  );
}

/* ---------------- setup (account creation) ---------------- */

function SetupPanel() {
  const { setMe } = useSession();
  const [username, setUsername] = useState('');
  const [capital, setCapital] = useState(10000);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const presets = [1000, 5000, 10000, 25000, 50000, 100000];

  async function start() {
    setErr('');
    setBusy(true);
    try {
      await api.consent();
      const amt = custom ? Number(custom.replace(/[^0-9.]/g, '')) : capital;
      if (!amt || amt < 1) {
        setErr('Enter a valid amount.');
        setBusy(false);
        return;
      }
      await api.saveProfile(username.trim());
      await api.accountStart(amt);
      const fresh = await api.me();
      setMe(fresh);
      setOk(`You're set with ${formatUsd(amt)} in virtual cash. Paste a token link to start.`);
      setBusy(false);
    } catch (e) {
      setBusy(false);
      setErr(e?.message || 'Could not start the account');
    }
  }

  return (
    <View>
      <Box>
        <Text style={styles.setupDone}>1 Signed in</Text>
        <Text style={[styles.setupStep, styles.setupActive]}>2 Pick a username and starting capital</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput style={styles.input} maxLength={24} value={username} onChangeText={setUsername} placeholder="How you show up on shared P&L cards…" placeholderTextColor={C.text3} />

        <Text style={{ ...styles.h1, marginTop: 18 }}>How much do you want to practice with?</Text>
        <Text style={{ ...styles.sub, marginBottom: 12 }}>Pick a size close to what you would really trade.</Text>

        <View style={styles.capGrid}>
          {presets.map((p) => {
            const active = capital === p && !custom;
            return (
              <Pressable key={p} style={({ pressed }) => [styles.capBtn, active && styles.capBtnActive, pressed && styles.pressed]} onPress={() => { setCapital(p); setCustom(''); }}>
                <Text style={[styles.capText, active && styles.capTextActive]}>${p >= 1000 ? `${p / 1000}K` : p}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.capCustom}>
          <Text style={styles.capCustomDollar}>$</Text>
          <TextInput style={styles.capCustomInput} value={custom} onChangeText={(t) => setCustom(t.replace(/[^0-9,]/g, ''))} placeholder="Custom amount, like 25,000…" placeholderTextColor={C.text3} keyboardType="number-pad" />
        </View>
        <Text style={styles.hint}>Between $1 and $1,000,000 in virtual USD</Text>

        <Notice kind="err" text={err} />
        <Notice kind="pink" text={ok} />

        <Pressable style={({ pressed }) => [styles.cta, { backgroundColor: C.paper }, (!username.trim() || busy) && { opacity: 0.5 }, pressed && styles.pressed]} disabled={!username.trim() || busy} onPress={start}>
          <Text style={[styles.ctaText, { color: '#0b0918' }]}>{busy ? 'Starting…' : 'OK, start trading'}</Text>
        </Pressable>
      </Box>
    </View>
  );
}

/* ---------------- main trade panel ---------------- */

function TradePanel({ me, setMe }) {
  const [side, setSide] = useState('BUY'); // BUY | SELL
  const signedIn = me?.account != null;
  const [ref, setRef] = useState(''); // manual input text
  const [token, setToken] = useState(null); // { chain, address }
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [position, setPosition] = useState(null);
  const [amount, setAmount] = useState('');
  const [sellPercent, setSellPercent] = useState(null);
  const [manualError, setManualError] = useState('');
  const [notice, setNotice] = useState(null); // { kind, text }
  const [busy, setBusy] = useState(false);
  const [editingPresets, setEditingPresets] = useState(false);
  const [presetDraft, setPresetDraft] = useState('');
  const [customPresets, setCustomPresets] = useState({ buy: null, sell: null });
  const addressInput = useRef(null);

  const symbol = (quote && quote.symbol) || (token ? token.chain.toUpperCase() : '') || 'token';
  const cash = me?.account?.cashBalance ?? 0;

  const notify = (kind, text, ttl = 5000) => {
    const id = Date.now();
    setNotice({ kind, text, id });
    setTimeout(() => setNotice((n) => (n && n.id === id ? null : n)), ttl);
  };

  const setTokenRef = useCallback((t) => {
    setToken(t);
    setQuote(null);
    setQuoteError('');
    setAmount('');
    setSellPercent(null);
  }, []);

  function loadManual() {
    const parsed = parseTokenRef(ref);
    if (!parsed) {
      setManualError('Paste a fomo.family token link, a DexScreener link, or chain:address.');
      return;
    }
    setManualError('');
    setTokenRef(parsed);
  }

  // poll asset state / quote
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let timer;
      const tick = async () => {
        try {
          if (!token) return;
          if (me?.account) {
            const d = await api.assetState(token.chain, token.address);
            if (!alive) return;
            setQuote(d.quote || null);
            setPosition(d.position || null);
            setQuoteError('');
            setMe((m) => ({ ...m, account: d.account }));
          } else {
            const d = await api.quote(token.chain, token.address);
            if (!alive) return;
            setQuote(d.quote || null);
            setQuoteError('');
          }
        } catch (e) {
          if (!alive) return;
          if (e instanceof ApiError && e.status === 0) setQuoteError('Paper server offline');
          else if ((e?.status === 502 && /MARKET_DATA/.test(e.code || '')) || e?.status === 502) setQuoteError('Market price unavailable');
          else setQuoteError(e?.code === 'ASSET_NOT_FOUND' ? 'No market found for this token' : e?.message || 'Market price unavailable');
        } finally {
          if (alive) timer = setTimeout(tick, POLL_MS);
        }
      };
      tick();
      return () => {
        alive = false;
        if (timer) clearTimeout(timer);
      };
    }, [token, signedIn, setMe]),
  );

  const amountUsd = amount ? Number(amount) : 0;
  const posQty = position ? Number(position.quantity) : 0;
  const posValue = position ? Number(position.marketValue || posQty * Number(position.currentPrice || 0)) : 0;

  const sellPercentFromPreset = sellPercent;

  let cta;
  if (!token) {
    cta = { label: 'Select a token', disabled: true, ready: false };
  } else if (quoteError) {
    cta = { label: quoteError, disabled: true };
  } else if (!quote) {
    cta = { label: `Loading ${symbol} price…`, disabled: true };
  } else if (side === 'BUY') {
    const feeRate = 0.001;
    if (!amountUsd) cta = { label: `Buy ${symbol}`, disabled: true };
    else if (amountUsd > cash / (1 + feeRate)) cta = { label: 'Not enough balance', disabled: true };
    else cta = { label: `Buy ${symbol}`, disabled: false, ready: true, kind: 'buy' };
  } else {
    if (posQty <= 0) cta = { label: `No ${symbol} to sell`, disabled: true };
    else if (!amountUsd && sellPercent == null) cta = { label: `Sell ${symbol}`, disabled: true };
    else cta = { label: `Sell ${symbol}`, disabled: false, ready: true, kind: 'sell' };
  }

  async function submit() {
    if (!token || !quote || cta.disabled) return;
    setBusy(true);
    try {
      const body = { chain: token.chain, address: token.address, side };
      if (side === 'BUY') body.amountUsd = Math.round(amountUsd * 100) / 100;
      else if (sellPercent != null) body.percent = sellPercent;
      else body.amountUsd = Math.round(amountUsd * 100) / 100;

      const d = await api.placeTrade(body);
      if (d.account) setMe((m) => ({ ...m, account: d.account }));
      const t = d.trade || {};
      const verb = side === 'BUY' ? 'Bought' : 'Sold';
      let text = `Paper ${verb.toLowerCase()} ${formatCompactQty(t.quantity)} ${t.symbol || symbol} at ${formatPrice(t.executionPrice)}`;
      if (t.closesPosition && t.realizedPnl != null) {
        text += ` · P&L ${formatSignedUsd(t.realizedPnl)}`;
        notify(t.realizedPnl >= 0 ? 'ok' : 'err', text, 7000);
      } else {
        notify('ok', text);
      }
      setAmount('');
      setSellPercent(null);
      setTokenRef(token); // force refresh; keeps token
    } catch (e) {
      notify('err', e?.message || 'Could not place the trade', 7000);
    } finally {
      setBusy(false);
    }
  }

  async function closePosition() {
    if (!token || !quote) return;
    setBusy(true);
    try {
      const d = await api.closePosition(token.chain, token.address);
      if (d.account) setMe((m) => ({ ...m, account: d.account }));
      const t = d.trade || {};
      notify(t.realizedPnl != null ? (t.realizedPnl >= 0 ? 'ok' : 'err') : 'ok', `Paper position closed at ${formatPrice(t.executionPrice)} · P&L ${formatSignedUsd(t.realizedPnl)}`, 7000);
      setAmount('');
      setSellPercent(null);
    } catch (e) {
      notify('err', e?.message || 'Could not close the position', 7000);
    } finally {
      setBusy(false);
    }
  }

  const availableLine = (() => {
    if (!me?.account) return 'Sign in first — restart the app.';
    if (side === 'BUY') return `${formatUsd(cash)} available`;
    if (posQty <= 0) return `0 ${symbol} available`;
    return `${formatCompactQty(posQty)} ${symbol} · ${formatUsd(posValue)} available`;
  })();

  const hintRight = (() => {
    if (side === 'SELL' && sellPercent != null) return `${sellPercent}% of position`;
    const qty = quote?.priceUsd && amountUsd ? amountUsd / Number(quote.priceUsd) : null;
    return qty && amountUsd ? `≈ ${formatCompactQty(qty)} ${symbol}` : 'Enter amount';
  })();

  const activePresets = side === 'BUY' ? customPresets.buy || DEFAULT_BUY : customPresets.sell || DEFAULT_SELL;

  return (
    <View>
      {/* asset strip / manual input */}
      {token ? (
        <View style={styles.assetStrip}>
          <Avatar symbol={quote?.symbol} chainId={token.chain} address={token.address} size={30} />
          <View style={styles.assetMain}>
            <Text style={styles.assetTitle}>{quote ? `${quote?.name || symbol} · open on FOMO` : 'Token from link'}</Text>
            <View style={styles.assetSub}>
              <View style={styles.chainChip}>
                <Text style={styles.chainChipText}>{token.chain.toLowerCase()}</Text>
              </View>
              <Text style={styles.assetAddr}>{shortAddr(token.address)}</Text>
            </View>
          </View>
          <View style={styles.assetRight}>
            <Text style={styles.assetPrice}>{quote?.priceUsd ? formatPrice(quote.priceUsd) : '…'}</Text>
            <Pressable onPress={() => setTokenRef(null)} style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Box pad={false} style={{ padding: 14 }}>
          <Text style={styles.label}>Token</Text>
          <View style={styles.manualRow}>
            <TextInput
              ref={addressInput}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://fomo.family/tokens/solana/…"
              placeholderTextColor="#8a8c96"
              value={ref}
              onChangeText={setRef}
              onSubmitEditing={loadManual}
            />
            <Pressable style={({ pressed }) => [styles.loadBtn, pressed && styles.pressed]} onPress={loadManual}>
              <Text style={styles.loadText}>Load</Text>
            </Pressable>
          </View>
          {!!manualError && (
            <View style={styles.bannerErr}>
              <Text style={{ ...styles.bannerText, color: C.red }}>{manualError}</Text>
            </View>
          )}
          <Text style={styles.hint}>Paste a fomo.family token link, a DexScreener link, or chain:address.</Text>
        </Box>
      )}

      {/* trade card */}
      <Box>
        {/* Buy/Sell tabs */}
        <View style={styles.sideTabs}>
          {[
            { id: 'BUY', label: 'Buy', active: side === 'BUY', color: C.green, bg: C.greenT },
            { id: 'SELL', label: 'Sell', active: side === 'SELL', color: C.red, bg: C.redT },
          ].map((t) => (
            <Pressable
              key={t.id}
              onPress={() => {
                if (side !== t.id) {
                  setSide(t.id);
                  setAmount('');
                  setSellPercent(null);
                }
              }}
              style={({ pressed }) => [styles.sideTab, t.active && t.id === 'BUY' && styles.sideTabBuy, t.active && t.id === 'SELL' && styles.sideTabSell, pressed && styles.pressed]}>
              <Text style={[styles.sideTabText, t.active && { color: t.color }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* amount */}
        <View style={styles.amountBox}>
          <Text style={[styles.dollar, !!amount && { color: C.text }]}>$</Text>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={(t) => {
              setSellPercent(null);
              setAmount(t.replace(/[^\d.]/g, '').replace(/(\..*?)\..*/g, '$1').slice(0, 12));
            }}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={C.text3}
          />
          <Text numberOfLines={1} style={styles.amountHint}>{hintRight}</Text>
        </View>

        {/* presets */}
        <View style={styles.presetsRow}>
          {activePresets.map((p) => {
            const isSell = side === 'SELL';
            const disabled = isSell && posQty <= 0;
            const active = isSell && sellPercentFromPreset === p;            return (
              <Pressable
                key={p}
                disabled={disabled}
                onPress={() => {
                  if (!isSell) {
                    setSellPercent(null);
                    setAmount(String(p));
                  } else {
                    setSellPercent(p);
                    setAmount('');
                  }
                }}
                style={({ pressed }) => [styles.presetBtn, active && styles.presetActive, disabled && styles.presetDisabled, pressed && styles.pressed]}>
                <Text style={[styles.presetText, disabled && { color: C.text3 }, active && { color: C.text }]}>
                  {isSell ? `${p}%` : `$${p >= 1000 ? p.toLocaleString('en-US') : p}`}
                </Text>
              </Pressable>
            );
          })}
          {/* MAX */}
          <Pressable
            onPress={() => {
            setSellPercent(null);
            if (side === 'BUY') setAmount(String(Math.floor((cash / (1 + FEE_RATE)) * 100) / 100));
            else {
              setAmount('');
              setSellPercent(100);
            }
          }}
            style={({ pressed }) => [styles.maxBtn, pressed && styles.pressed]}>
            <Text style={styles.maxText}>Max</Text>
          </Pressable>
          {/* gear */}
          <Pressable onPress={() => setEditingPresets((v) => !v)} style={({ pressed }) => [styles.gearBtn, pressed && styles.pressed]}>
            <Text style={styles.gearText}>⚙</Text>
          </Pressable>
        </View>

        {editingPresets && (
          <View style={styles.presetEditor}>
            <Text style={styles.label}>{side === 'BUY' ? 'Buy presets ($)' : 'Sell presets (%)'}</Text>
            <TextInput
              style={styles.input}
              value={presetDraft}
              onChangeText={setPresetDraft}
              placeholder={activePresets.join(', ')}
              placeholderTextColor={C.text3}
              keyboardType="numbers-and-punctuation"
            />
            <View style={styles.presetEditorBtns}>
              <Pressable style={({ pressed }) => [styles.btnSm, pressed && styles.pressed]} onPress={() => setEditingPresets(false)}>
                <Text style={styles.btnSmText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.btnSm, { backgroundColor: C.paper }, pressed && styles.pressed]}
                onPress={() => {
                  const list = presetDraft.split(/[,\s]+/).map(Number).filter((n) => n > 0 && !Number.isNaN(n)).slice(0, 4);
                  if (list.length >= 2) {
                    setCustomPresets((p) => ({ ...p, [side === 'BUY' ? 'buy' : 'sell']: list }));
                    setEditingPresets(false);
                  }
                }}>
                <Text style={[styles.btnSmText, { color: '#0b0918' }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* available */}
        <Text style={styles.available}>{availableLine}</Text>

        {notice && <Notice kind={notice.kind} text={notice.text} />}

        {/* CTA */}
        <Pressable
          disabled={cta.disabled || busy}
          onPress={submit}
          style={({ pressed }) => [
            styles.cta,
            (cta.kind === 'buy' || cta.kind === 'sell') && cta.kind === 'buy' && styles.ctaReadyBuy,
            cta.kind === 'sell' && styles.ctaReadySell,
            pressed && styles.pressed,
            (!busy && (cta.disabled || cta.ready)) && (busy ? styles.ctaBusy : null),
            busy && styles.ctaBusy,
          ]}>
          <Text style={[styles.ctaText, { color: '#060510' }, cta.kind && cta.kind !== 'buy' && cta.kind !== 'sell' && { color: C.text2 }]}>{cta.label}</Text>
          <Text style={[styles.paperTag, (cta.kind === 'buy' || cta.kind === 'sell') && { backgroundColor: 'rgba(6,5,16,0.18)', color: '#060510' }]}>PAPER</Text>
        </Pressable>

        {/* position card + close */}
        {position && posQty > 0 && (
          <View style={styles.posCard}>
            <View style={styles.posRow}>
              <Text style={styles.posLabel}>Position</Text>
              <Text style={styles.posValue}>
                {formatCompactQty(posQty)} {symbol} · {formatUsd(posValue)}
              </Text>
            </View>
            <View style={styles.posRow}>
              <Text style={styles.posLabel}>Entry</Text>
              <Text style={styles.posValue}>{formatPrice(position.averageEntryPrice)} · {formatAge(position.openedAt)}</Text>
            </View>
            <View style={styles.posRow}>
              <Text style={styles.posLabel}>Unrealized</Text>
              <Text style={[styles.posValue, { color: position.unrealizedPnl >= 0 ? C.green : C.red }]}>
                {formatSignedUsd(position.unrealizedPnl)} ({formatPct(position.unrealizedPnlPct)})
              </Text>
            </View>
            <Pressable style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]} onPress={closePosition} disabled={busy}>
              <Text style={styles.closeText}>Sell all</Text>
            </Pressable>
          </View>
        )}
      </Box>

      <Text style={styles.footNote}>Simulated fills at live prices via {getServerUrl().replace(/^https?:\/\//, '')} · no real funds</Text>
    </View>
  );
}

/* ---------------- styles ---------------- */

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 12, paddingBottom: 24 },
  h1: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.02 },
  sub: { color: C.text2, fontSize: 13 },
  label: { color: C.text2, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: { height: 40, borderRadius: 10, backgroundColor: C.bg2, borderColor: C.lineStrong, borderWidth: 1, color: C.text, paddingHorizontal: 12, fontSize: 14, flex: 1 },
  hint: { color: C.text3, fontSize: 11, lineHeight: 15, marginTop: 8 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  setupDone: { color: C.green, fontSize: 13, fontWeight: '700' },
  setupStep: { color: C.text2, fontSize: 14, fontWeight: '700', marginTop: 10 },
  setupActive: { color: C.paper },
  capGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  capBtn: { width: '31.5%', height: 48, borderRadius: 10, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg2, alignItems: 'center', justifyContent: 'center' },
  capBtnActive: { backgroundColor: C.paperT, borderColor: C.paperLine, borderWidth: 1.5 },
  capText: { color: C.text, fontSize: 16, fontWeight: '700' },
  capTextActive: { color: C.paper },
  capCustom: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 10, backgroundColor: C.bg2, borderColor: C.lineStrong, borderWidth: 1, marginTop: 12, paddingHorizontal: 14, gap: 6 },
  capCustomDollar: { color: C.text3, fontSize: 20, fontWeight: '600' },
  capCustomInput: { flex: 1, color: C.text, fontSize: 20, fontWeight: '600' },
  bannerErr: { backgroundColor: C.redT, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 10, marginTop: 10 },
  bannerText: { fontSize: 13, lineHeight: 18 },
  assetStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg2, borderRadius: 12, borderWidth: 1, borderColor: C.paperLine, padding: 10, gap: 10, marginBottom: 12 },
  assetMain: { flex: 1 },
  assetTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  assetSub: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  chainChip: { backgroundColor: C.bg3, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  chainChipText: { color: C.text2, fontSize: 10, fontWeight: '600', textTransform: 'lowercase' },
  assetAddr: { color: C.text2, fontSize: 12, fontVariant: ['tabular-nums'] },
  assetRight: { alignItems: 'flex-end', gap: 4 },
  assetPrice: { color: C.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  clearBtn: { borderRadius: 8, borderWidth: 1, borderColor: C.lineStrong, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: C.bg3 },
  clearText: { color: C.text2, fontSize: 13, fontWeight: '700' },
  manualRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  loadBtn: { height: 40, paddingHorizontal: 16, borderRadius: 10, backgroundColor: C.bg3, alignItems: 'center', justifyContent: 'center' },
  loadText: { color: C.text, fontSize: 13, fontWeight: '700' },
  sideTabs: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  sideTab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line },
  sideTabBuy: { backgroundColor: C.greenT, borderColor: 'transparent' },
  sideTabSell: { backgroundColor: C.redT, borderColor: 'transparent' },
  sideTabText: { color: C.text2, fontSize: 16, fontWeight: '700' },
  amountBox: { flexDirection: 'row', alignItems: 'center', height: 72, borderRadius: 12, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.lineStrong, paddingHorizontal: 16, gap: 6 },
  dollar: { color: C.text3, fontSize: 30, fontWeight: '500' },
  amountInput: { flex: 1, color: C.text, fontSize: 30, fontWeight: '500', fontVariant: ['tabular-nums'], padding: 0 },
  amountHint: { color: C.text3, fontSize: 14, maxWidth: 110 },
  presetsRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  presetBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.lineStrong },
  presetActive: { backgroundColor: C.bg3, borderColor: 'rgba(203,208,235,0.16)' },
  presetDisabled: { opacity: 0.45 },
  presetText: { color: C.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  maxBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.paperLine },
  maxText: { color: C.paper, fontSize: 14, fontWeight: '700' },
  gearBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  gearText: { color: C.text2, fontSize: 18 },
  presetEditor: { marginTop: 12, gap: 8, backgroundColor: C.bg3solid, borderRadius: 10, padding: 10 },
  presetEditorBtns: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  btnSm: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.lineStrong },
  btnSmText: { color: C.text, fontSize: 13, fontWeight: '700' },
  available: { color: C.text2, fontSize: 14, fontWeight: '500', marginTop: 12 },
  cta: { marginTop: 10, height: 48, borderRadius: 12, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.lineStrong, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  ctaReadyBuy: { backgroundColor: C.green, borderColor: 'transparent' },
  ctaReadySell: { backgroundColor: C.red, borderColor: 'transparent' },
  ctaBusy: { opacity: 0.7 },
  ctaDisabled: {},
  ctaText: { fontSize: 16, fontWeight: '700' },
  paperTag: { position: 'absolute', right: 10, fontSize: 10, fontWeight: '700', color: C.paper, letterSpacing: 0.8, backgroundColor: C.paperT, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden' },
  posCard: { marginTop: 10, borderRadius: 10, backgroundColor: C.bg3solid, borderWidth: 1, borderColor: C.line, padding: 10, gap: 6 },
  posRow: { flexDirection: 'row', justifyContent: 'space-between' },
  posLabel: { color: C.text3, fontSize: 13 },
  posValue: { color: C.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  closeBtn: { marginTop: 4, height: 34, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,98,46,0.35)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: C.red, fontSize: 13, fontWeight: '700' },
  footNote: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 14 },
});
