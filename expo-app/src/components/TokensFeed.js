// Tokens feed — shared by the Graduados and Trending tabs
// (mirror of renderTokens / renderTrending + syncTokensList).
import { useEffect, useState } from 'react';import { View, Text, Pressable, StyleSheet, ScrollView, Linking, ActivityIndicator } from 'react-native';
import { api } from '../lib/api';
import { C } from '../lib/theme';
import { formatCompactUsd } from '../lib/format';
import { Box, SectionHeader, Notice } from './ui';
import Avatar from './Avatar';

const POLL_MS = 500;

export default function TokensFeed({ mode, onTokenPress }) {
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
    <ScrollView style={{ flex: 1 }} contentContainerStyle={k.scroll}>
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
        {list.map((t) => {
          const rowContent = (
            <>
              <View style={k.rowTop}>
                <Avatar symbol={t.symbol} chainId={t.chainId} address={t.address} size={34} />
                <View style={k.rowMain}>
                  <Text style={k.rowSymbol}>{t.symbol}</Text>
                  <Text numberOfLines={1} style={k.rowName}>{t.name}</Text>
                </View>
              </View>
              <View style={k.statRow}>
                <View style={k.stat}>
                  <Text style={k.statLabel}>Security</Text>
                  <Text style={k.statValue}>{t.securityScore != null ? Number(t.securityScore) : '—'}</Text>
                </View>
                <View style={k.stat}>
                  <Text style={k.statLabel}>Market cap</Text>
                  <Text style={k.statValue}>{formatCompactUsd(t.marketCap)}</Text>
                </View>
                <View style={k.stat}>
                  <Text style={k.statLabel}>Holders</Text>
                  <Text style={k.statValue}>{t.holders != null ? Number(t.holders).toLocaleString('en-US') : '—'}</Text>
                </View>
              </View>
            </>
          );
          return (
            <View key={t.address} style={k.rowWrap}>
              {onTokenPress ? (
                <Pressable style={({ pressed }) => [k.rowCard, pressed && k.pressed]} onPress={() => onTokenPress(t)}>
                  {rowContent}
                </Pressable>
              ) : (
                <View style={k.rowCard}>{rowContent}</View>
              )}
              <Pressable style={({ pressed }) => [k.linkBtn, pressed && k.pressed]} onPress={() => openOnFomo(t)}>
                <Text style={k.linkText}>↗</Text>
              </Pressable>
            </View>
          );
        })}
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
  rowWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  rowCard: { flex: 1, gap: 8, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowMain: { flex: 1, minWidth: 0 },
  rowSymbol: { color: C.text, fontSize: 15, fontWeight: '700' },
  rowName: { color: C.text2, fontSize: 11, marginTop: 1 },
  linkBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg3 },
  linkText: { color: C.text2, fontSize: 14 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  stat: { alignItems: 'flex-start', minWidth: 0, flex: 1 },
  statLabel: { color: C.text3, fontSize: 9, textTransform: 'uppercase', marginBottom: 2, letterSpacing: 0.4 },
  statValue: { color: C.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  foot: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 10 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});