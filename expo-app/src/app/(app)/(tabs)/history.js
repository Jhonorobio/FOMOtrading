// HISTORY TAB — mirror of renderHistory + tradeRow (sidepanel.js:595-675).
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput } from 'react-native';
import { api } from '../../../lib/api';
import { C } from '../../../lib/theme';
import { formatUsd, formatSignedUsd, formatCompactQty, formatPrice, formatClock, dayLabel, formatCompactUsd, shortAddr } from '../../../lib/format';
import { Screen, Box, Notice, Seg } from '../../../components/ui';
import Avatar from '../../../components/Avatar';

const LIMIT = 200;

export default function HistoryScreen() {
  const [side, setSide] = useState(''); // '' | BUY | SELL
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim().toUpperCase()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let alive = true;
    api
      .trades({ side: side || undefined, asset: debounced || undefined, scope: 'current', limit: LIMIT })
      .then((d) => {
        if (!alive) return;
        setRows(d.trades || []);
        setError('');
      })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message || 'Could not load history');
      });
    return () => {
      alive = false;
    };
  }, [side, debounced]);

  const grouped = useMemo(() => {
    if (!rows) return [];
    const byDay = new Map();
    for (const t of rows) {
      const d = dayLabel(t.timestamp);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(t);
    }
    return [...byDay.entries()];
  }, [rows]);

  return (
    <Screen title="History">
      <ScrollView contentContainerStyle={hStyles.scroll}>
        <View style={hStyles.filters}>
          <Seg
            value={side}
            onChange={setSide}
            options={[
              { value: '', label: 'All' },
              { value: 'BUY', label: 'Buys' },
              { value: 'SELL', label: 'Sells' },
            ]}
          />
          <Box pad={false} style={{ marginTop: 8, height: 40, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 }}>
            <Text style={hStyles.searchIcon}>⌕</Text>
            <TextInput
              style={hStyles.searchInput}
              placeholder="Search a ticker, like PORK…"
              placeholderTextColor="#8a8c96"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </Box>
        </View>

        {error ? <Notice kind="err" text={error} /> : null}

        <Box pad={false} style={hStyles.list}>
          {rows == null && (
            <View style={hStyles.skeletonWrap}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={hStyles.skeleton} />
              ))}
            </View>
          )}
          {grouped.map(([day, trades]) => (
            <View key={day}>
              <Text style={hStyles.dayH}>{day}</Text>
              {trades.map((t) => (
                <View key={t.id} style={hStyles.row}>
                  <Pressable style={hStyles.rowTop} onPress={() => setExpanded(expanded === t.id ? null : t.id)}>
                    <Avatar symbol={t.symbol} chainId={t.chainId} address={t.address} size={38} />
                    <View style={hStyles.rowMain}>
                      <Text style={hStyles.rowName}>{t.symbol}</Text>
                      <Text style={hStyles.rowSub}>
                        <Text style={{ color: t.side === 'BUY' ? C.green : C.red }}>{t.side === 'BUY' ? 'Bought' : 'Sold'}</Text>
                        {' '}{formatCompactQty(t.quantity)} at {formatPrice(t.executionPrice)}
                      </Text>
                    </View>
                    <View style={hStyles.rowRight}>
                      <Text style={hStyles.rowValue}>{formatUsd(t.total ?? t.requestedValue)}</Text>
                      {(t.realizedPnl != null && t.status === 'closed') ? (
                        <Text style={[hStyles.rowDelta, { color: t.realizedPnl >= 0 ? C.green : C.red }]}>P&L {formatSignedUsd(t.realizedPnl)}</Text>
                      ) : (
                        <Text style={hStyles.rowTime}>{formatClock(t.timestamp)}</Text>
                      )}
                    </View>
                  </Pressable>
                  {expanded === t.id && (
                    <View style={hStyles.detail}>
                      <DetailLine k="Time" v={new Date(t.timestamp).toLocaleTimeString('en-US')} />
                      <DetailLine k="Requested" v={formatUsd(t.requestedValue)} />
                      <DetailLine k="Market price" v={formatPrice(t.marketPrice)} />
                      <DetailLine k="Fill price" v={formatPrice(t.executionPrice)} />
                      <DetailLine k="Simulated fee" v={formatUsd(t.fee)} />
                      <DetailLine k="Simulated slippage" v={formatUsd(t.slippage)} />
                      <DetailLine k="Cash after" v={formatUsd(t.cashAfter)} />
                      <DetailLine k="Liquidity" v={formatCompactUsd(t.liquidityUsd)} />
                      <DetailLine k="Market cap" v={formatCompactUsd(t.marketCapUsd)} />
                      <DetailLine k="Position" v={t.status === 'closed' ? 'Closed' : 'Still open'} />
                      <Text style={hStyles.shortAddr}>{shortAddr(t.address)}</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          ))}
          {rows != null && grouped.length === 0 && (
            <View style={hStyles.empty}>
              <Text style={hStyles.emptyTitle}>{side || debounced || !error ? 'No trades match…' : 'No paper trades yet'}</Text>
              <Text style={hStyles.emptySub}>
                {side || debounced ? 'Try a different ticker or filter.' : 'Your buys and sells show up here, newest first.'}
              </Text>
            </View>
          )}
        </Box>
      </ScrollView>
    </Screen>
  );
}

function DetailLine({ k, v }) {
  return (
    <View style={hStyles.dlRow}>
      <Text style={hStyles.dlKey}>{k}</Text>
      <Text style={hStyles.dlVal}>{v}</Text>
    </View>
  );
}

const hStyles = StyleSheet.create({
  scroll: { paddingHorizontal: 12, paddingBottom: 24 },
  filters: { marginTop: 4 },
  searchIcon: { color: C.text3, fontSize: 16, marginRight: 6 },
  searchInput: { flex: 1, color: C.text, fontSize: 14, paddingVertical: 0 },
  list: { padding: 10 },
  dayH: { color: C.text2, fontSize: 12, fontWeight: '600', paddingHorizontal: 6, paddingTop: 10, paddingBottom: 2 },
  row: { borderRadius: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', padding: 8, gap: 10 },
  rowMain: { flex: 1 },
  rowName: { color: C.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: C.text2, fontSize: 12, fontVariant: ['tabular-nums'] },
  rowRight: { alignItems: 'flex-end' },
  rowValue: { color: C.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowDelta: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowTime: { color: C.text3, fontSize: 12 },
  detail: { paddingLeft: 56, paddingBottom: 10 },
  dlRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  dlKey: { color: C.text3, fontSize: 13 },
  dlVal: { color: C.text2, fontSize: 13, fontVariant: ['tabular-nums'] },
  shortAddr: { color: C.text3, fontSize: 11, marginTop: 4 },
  empty: { alignItems: 'center', padding: 22 },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  emptySub: { color: C.text3, fontSize: 13, marginTop: 4, textAlign: 'center' },
  skeletonWrap: { padding: 6 },
  skeleton: { height: 52, borderRadius: 10, backgroundColor: C.bg2, marginBottom: 8 },
});
