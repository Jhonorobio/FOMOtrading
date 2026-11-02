// Tokens feed — shared by the Graduados and Trending tabs
// (mirror of renderTokens / renderTrending + syncTokensList).
import { useEffect, useState } from 'react';import { View, Text, Pressable, StyleSheet, ScrollView, Linking, ActivityIndicator } from 'react-native';
import { api } from '../lib/api';
import { C } from '../lib/theme';
import { formatCompactUsd } from '../lib/format';
import { Box, SectionHeader, Notice } from './ui';
import Avatar from './Avatar';

const POLL_MS = 2000;

export default function TokensFeed({ mode }) {
  // mode: 'graduados' (newest first) | 'trending' (market cap desc)
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState('');

  const filterSafe = (list) =>
    (list || []).filter((t) => {
      const score = Number(t.securityScore);
      if (Number.isFinite(score) && score > 0 && score < 50) return false;
      if (!Number.isFinite(score) && t.security && !('securityScore' in t)) return true;
      return true;
    });

  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const d = await api.tokens();
        if (!alive) return;
        setTokens(filterSafe(d.tokens));
        setError('');
      } catch (e) {
        if (alive) setError(e?.message || 'The token feed is unavailable right now');
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const list = tokens || [];
  if (mode === 'trending') list.sort((a, b) => Number(b.marketCap || 0) - Number(a.marketCap || 0));
  else list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const openOnFomo = async (t) => {
    const url = `https://fomo.family/tokens/${t.chainId}/${t.address}`;
    try {
      await Linking.openURL(url);
    } catch {}
  };

  const title = mode === 'trending' ? 'Trending' : 'Discovered tokens';

  return (
    <ScrollView contentContainerStyle={k.scroll}>
      <SectionHeader title={title} count={list.length} />
      <Box pad={false} style={k.listBox}>
        {tokens == null && !error && (
          <View style={k.loading}>
            <ActivityIndicator color={C.paper} />
          </View>
        )}
        {error ? <Notice kind="err" text={error} /> : null}
        {tokens != null && list.length === 0 && !error && (
          <View style={[k.empty, mode === 'trending' && k.emptyTrending]}>
            <Text style={k.emptyTitle}>{mode === 'trending' ? 'No trending tokens yet' : 'No tokens yet'}</Text>
            <Text style={k.emptySub}>The Mobula discovery feed is connecting. Wait a few seconds for live tokens to appear.</Text>
          </View>
        )}
        {list.map((t) => (
          <View key={t.address} style={k.row}>
            <Avatar symbol={t.symbol} chainId={t.chainId} address={t.address} size={30} />
            <View style={k.rowMain}>
              <Text style={k.rowSymbol}>{t.symbol}</Text>
              <Text numberOfLines={1} style={k.rowName}>{t.name}</Text>
            </View>
            <Pressable style={({ pressed }) => [k.linkBtn, pressed && k.pressed]} onPress={() => openOnFomo(t)}>
              <Text style={k.linkText}>↗</Text>
            </Pressable>
            <View style={k.stat}>
              <Text style={k.statLabel}>Market cap</Text>
              <Text style={k.statValue}>{formatCompactUsd(t.marketCap)}</Text>
            </View>
            <View style={k.stat}>
              <Text style={k.statLabel}>Holders</Text>
              <Text style={k.statValue}>{t.holders != null ? Number(t.holders).toLocaleString('en-US') : '—'}</Text>
            </View>
          </View>
        ))}
      </Box>
      <Text style={k.foot}>Live feed · new tokens land here automatically</Text>
    </ScrollView>
  );
}

const k = StyleSheet.create({
  scroll: { paddingHorizontal: 12, paddingBottom: 24 },
  listBox: { padding: 8 },
  loading: { padding: 22, alignItems: 'center' },
  empty: { alignItems: 'center', padding: 22 },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  emptySub: { color: C.text3, fontSize: 13, marginTop: 4, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 8, gap: 8, marginBottom: 6 },
  rowMain: { flex: 1, minWidth: 60 },
  rowSymbol: { color: C.text, fontSize: 15, fontWeight: '700' },
  rowName: { color: C.text2, fontSize: 12 },
  linkBtn: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: C.text3, fontSize: 14 },
  stat: { width: 78, alignItems: 'flex-end' },
  statLabel: { color: C.text3, fontSize: 10, textTransform: 'uppercase' },
  statValue: { color: C.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  foot: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 10 },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
});
