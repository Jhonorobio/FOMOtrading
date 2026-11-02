// PORTFOLIO TAB — mirror of renderPortfolio (sidepanel.js:533-582) + positions rows.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { C } from '../../../lib/theme';
import { formatUsd, formatSignedUsd, formatPct, formatCompactQty, formatPrice, formatCompactUsd, formatDuration } from '../../../lib/format';
import { Screen, Box, Notice, SectionHeader } from '../../../components/ui';
import Avatar from '../../../components/Avatar';

const POLL_MS = 15000;
const DUST_USD = 3;

export default function PortfolioScreen() {
  const { me } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  const [unit, setUnit] = useState('$');
  const [showDust, setShowDust] = useState(false);
  const [notice, setNotice] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const tzOffset = new Date().getTimezoneOffset();
        const d = await api.portfolio(tzOffset);
        if (alive) {
          setData(d);
          setError('');
        }
      } catch (e) {
        if (alive) setError(e?.message || 'Could not load portfolio');
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS);
      }
    };
    if (me?.account) tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [me?.account]);

  const perf = data?.performance || {};
  const positions = data?.positions || [];
  const closedFromPortfolio = data?.closedTrades || [];

  const rowsOpen = positions.filter((p) => (open ? Number(p.marketValue) >= DUST_USD : false));
  const dustCount = positions.filter((p) => Number(p.marketValue) < DUST_USD).length;

  async function sellAll(position) {
    try {
      const d = await api.closePosition(position.chainId, position.address);
      const t = d.trade || {};
      setNotice({
        kind: t.realizedPnl >= 0 ? 'ok' : 'err',
        text: `Paper position closed at ${formatPrice(t.executionPrice)} · P&L ${formatSignedUsd(t.realizedPnl)}`,
      });
      setExpanded(null);
      const fresh = await api.portfolio(new Date().getTimezoneOffset());
      setData(fresh);
    } catch (e) {
      setNotice({ kind: 'err', text: e?.message || 'Could not close the position' });
    }
    setTimeout(() => setNotice(null), 7000);
  }

  return (
    <Screen title="Portfolio" right={<Text onPress={() => router.push('/(app)/settings')} style={pStyles.gear}>⚙</Text>}>
      <ScrollView contentContainerStyle={pStyles.scroll}>
        <Text style={pStyles.panelTitle}>Portfolio</Text>
        <View style={pStyles.equity}>
          <Text style={pStyles.equityLabel}>Total equity</Text>
          <Text style={pStyles.equityValue}>{formatUsd(perf.totalEquity)}</Text>
          <Text style={[pStyles.equityPnl, { color: (perf.totalPnl ?? 0) >= 0 ? C.green : C.red }]}>
            {formatSignedUsd(perf.totalPnl)} ({formatPct(perf.totalPnlPct)})
            <Text style={pStyles.equitySince}>{`  (since starting with ${formatUsd(perf.startingBalance)})`}</Text>
          </Text>
        </View>

        <Box pad={false} style={pStyles.statGrid}>
          {[
            { k: 'Cash', v: formatUsd(perf.cash) },
            { k: 'Invested', v: formatUsd(perf.invested) },
            { k: 'Today', v: formatSignedUsd(perf.todayPnl), color: (perf.todayPnl ?? 0) > 0 ? C.green : (perf.todayPnl ?? 0) < 0 ? C.red : C.text },
            { k: 'Unrealized', v: perf.marketValue != null && perf.invested != null ? formatSignedUsd(Number(perf.marketValue) - Number(perf.invested)) : '—' },
            { k: 'Win rate', v: perf.winRate != null ? `${Math.round(perf.winRate * 100)}%` : perf.wins != null ? `${perf.wins} won, ${perf.losses} lost` : '—' },
            { k: 'Trades', v: perf.tradeCount != null ? `${perf.tradeCount}` : '—', hint: `${perf.buyCount || 0} buys, ${perf.sellCount || 0} sells` },
          ].map((s, i) => (
            <View key={s.k} style={[pStyles.statCell, i >= 3 && pStyles.statRow2]}>
              <Text style={pStyles.statLabel}>{s.k}</Text>
              <Text style={[pStyles.statValue, { color: s.color || C.text }]}>{s.v}</Text>
              {s.hint && <Text style={pStyles.statHint}>{s.hint}</Text>}
            </View>
          ))}
        </Box>

        {error ? <Notice kind="err" text={error} /> : null}

        <SectionHeader title="Your positions" />

        <Box pad={false} style={pStyles.posBox}>
          <View style={pStyles.posControls}>
            <Pressable style={({ pressed }) => [pStyles.chip, unit === '$' && pStyles.chipActive, pressed && pStyles.pressed]} onPress={() => setUnit('$')}>
              <Text style={[pStyles.chipText, unit === '$' && { color: C.text }]}>$</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [pStyles.chip, unit === 'MC' && pStyles.chipActive, pressed && pStyles.pressed]} onPress={() => setUnit('MC')}>
              <Text style={[pStyles.chipText, unit === 'MC' && { color: C.text }]}>MC</Text>
            </Pressable>
            <View style={{ width: 8 }} />
            <Pressable style={({ pressed }) => [pStyles.chip, open && pStyles.chipPaper, pressed && pStyles.pressed]} onPress={() => setOpen(true)}>
              <Text style={[pStyles.chipText, open && { color: C.paper }]}>Open</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [pStyles.chip, !open && pStyles.chipPaper, pressed && pStyles.pressed]} onPress={() => setOpen(false)}>
              <Text style={[pStyles.chipText, !open && { color: C.paper }]}>Closed</Text>
            </Pressable>
          </View>

          {open ? (
            <>
              {rowsOpen.map((p) => {
                return (
                  <View key={p.assetId} style={pStyles.row}>
                    <Pressable style={pStyles.rowTop} onPress={() => setExpanded(expanded === p.assetId ? null : p.assetId)}>
                      <Avatar symbol={p.symbol} chainId={p.chainId} address={p.address} size={38} />
                      <View style={pStyles.rowMain}>
                        <Text style={pStyles.rowName}>{p.symbol}</Text>
                        <Text style={pStyles.rowSub}>{`${formatCompactQty(p.quantity)} ${p.symbol}`}</Text>
                      </View>
                      <View style={pStyles.rowRight}>
                        <Text style={pStyles.rowValue}>
                          {unit === '$' ? formatUsd(p.marketValue) : formatCompactUsd(p.marketCapUsd)}
                        </Text>
                        <Text style={[pStyles.rowDelta, { color: Number(p.unrealizedPnlPct) >= 0 ? C.green : C.red }]}>
                          {Number(p.unrealizedPnlPct) >= 0 ? '▲' : '▼'} {formatPct(p.unrealizedPnlPct, { signed: false })}
                        </Text>
                      </View>
                    </Pressable>
                    {expanded === p.assetId && (
                      <View style={pStyles.rowDetail}>
                        <View style={pStyles.detailCols}>
                          <Text style={pStyles.detailLine}>Entry {formatPrice(p.averageEntryPrice)}</Text>
                          <Text style={pStyles.detailLine}>
                            Unrealized <Text style={{ color: Number(p.unrealizedPnl) >= 0 ? C.green : C.red }}>{formatSignedUsd(p.unrealizedPnl)}</Text>
                          </Text>
                        </View>
                        <Pressable style={({ pressed }) => [pStyles.sellAll, pressed && pStyles.pressed]} onPress={() => sellAll(p)}>
                          <Text style={pStyles.sellAllText}>Sell all</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
              {rowsOpen.length === 0 && (
                <View style={pStyles.empty}>
                  <Text style={pStyles.emptyTitle}>{dustCount ? 'Only small positions under $3.' : 'No open positions'}</Text>
                  {!dustCount && <Text style={pStyles.emptySub}>Buy a token and it shows up here.</Text>}
                </View>
              )}
              {dustCount > 0 && (
                <Pressable style={pStyles.dustBtn} onPress={() => setShowDust((v) => !v)}>
                  <Text style={pStyles.dustText}>{showDust ? 'Hide dust' : `Show dust (${dustCount})`}</Text>
                </Pressable>
              )}
              {showDust &&
                positions
                  .filter((q) => Number(q.marketValue) < DUST_USD)
                  .map((p) => (
                    <View key={`dust-${p.assetId}`} style={pStyles.row}>
                      <View style={pStyles.rowTop}>
                        <Avatar symbol={p.symbol} chainId={p.chainId} address={p.address} size={38} />
                        <View style={pStyles.rowMain}>
                          <Text style={pStyles.rowName}>{p.symbol}</Text>
                          <Text style={pStyles.rowSub}>{formatCompactQty(p.quantity)} {p.symbol}</Text>
                        </View>
                        <Text style={pStyles.rowValue}>{formatUsd(p.marketValue)}</Text>
                      </View>
                    </View>
                  ))}
            </>
          ) : (
            <>
              {closedFromPortfolio.map((t) => (
                <View key={`${t.id}`} style={pStyles.row}>
                  <View style={pStyles.rowTop}>
                    <Avatar symbol={t.symbol} chainId={t.chainId} address={t.address} size={38} />
                    <View style={pStyles.rowMain}>
                      <Text style={pStyles.rowName}>{t.symbol}</Text>
                      <Text style={pStyles.rowSub}>Held {formatDuration(t.holdMs)}</Text>
                    </View>
                    <View style={pStyles.rowRight}>
                      <Text style={pStyles.rowValue}>{formatUsd(t.proceedsUsd)}</Text>
                      <Text style={[pStyles.rowDelta, { color: Number(t.returnPct) >= 0 ? C.green : C.red }]}>
                        {Number(t.returnPct) >= 0 ? '▲' : '▼'} {formatPct(t.returnPct * 100, { signed: false })}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
              {closedFromPortfolio.length === 0 && (
                <View style={pStyles.empty}>
                  <Text style={pStyles.emptyTitle}>No closed trades yet</Text>
                  <Text style={pStyles.emptySub}>Sell a whole position and its result lands here.</Text>
                </View>
              )}
            </>
          )}

          {notice && <Notice kind={notice.kind} text={notice.text} />}
        </Box>

        <Text style={pStyles.foot}>Connected · market data from the paper server</Text>
      </ScrollView>
    </Screen>
  );
}

const pStyles = StyleSheet.create({
  scroll: { paddingHorizontal: 12, paddingBottom: 24 },
  gear: { color: C.text2, fontSize: 20, padding: 6 },
  panelTitle: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.02, marginBottom: 8 },
  equity: { marginBottom: 12 },
  equityLabel: { color: C.text2, fontSize: 13 },
  equityValue: { color: C.text, fontSize: 34, fontWeight: '700', letterSpacing: -0.03, fontVariant: ['tabular-nums'] },
  equityPnl: { fontSize: 14, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  equitySince: { color: C.text3, fontSize: 12, fontWeight: '400' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  statCell: { width: '33.33%', padding: 11, borderColor: C.line, borderRightWidth: 1, borderBottomWidth: 1 },
  statRow2: { borderBottomWidth: 0 },
  statLabel: { color: C.text2, fontSize: 12 },
  statValue: { color: C.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statHint: { color: C.text3, fontSize: 11, marginTop: 2 },
  posBox: { padding: 10 },
  posControls: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: C.lineStrong, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: C.bg },
  chipActive: { backgroundColor: C.bg3 },
  chipPaper: { backgroundColor: C.paperT, borderColor: C.paperLine },
  chipText: { color: C.text2, fontSize: 13, fontWeight: '700' },
  row: { borderBottomWidth: 1, borderColor: C.line, borderRadius: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', padding: 8, gap: 10, backgroundColor: 'rgba(33,201,94,0.04)', borderRadius: 10 },
  rowMain: { flex: 1 },
  rowName: { color: C.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: C.text2, fontSize: 12 },
  rowRight: { alignItems: 'flex-end' },
  rowValue: { color: C.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowDelta: { color: C.green, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowDetail: { paddingLeft: 56, paddingBottom: 10, paddingTop: 2, gap: 6 },
  detailCols: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  detailLine: { color: C.text2, fontSize: 13, fontVariant: ['tabular-nums'] },
  sellAll: { alignSelf: 'flex-start', height: 30, borderRadius: 8, backgroundColor: C.red, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  sellAllText: { color: '#060510', fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', padding: 22 },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  emptySub: { color: C.text3, fontSize: 13, marginTop: 4, textAlign: 'center' },
  dustBtn: { padding: 8, alignItems: 'center' },
  dustText: { color: C.text3, fontSize: 13, fontWeight: '500' },
  foot: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 12 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
