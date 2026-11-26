// Telegram detected tokens feed — shows tokens detected in Telegram channel messages.
// Each card shows: channel name, detection time, token symbol/name, market cap.
// Tapping a token navigates to the Trade tab.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { router } from 'expo-router';
import { api } from '../lib/api';
import { C } from '../lib/theme';
import { formatCompactUsd } from '../lib/format';
import { Box, SectionHeader, Notice } from './ui';
import Avatar from './Avatar';

const POLL_MS = 2000;

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export default function TelegramMessagesFeed({ onTokenPress }) {
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const d = await api.telegramDetectedTokens({ limit: 50 });
        if (!alive) return;
        setTokens(d.tokens ?? []);
        setError('');
        try {
          const st = await api.telegramStatus();
          if (alive) setStatus(st);
        } catch {}
      } catch (e) {
        if (alive) setError(e?.message || 'No se pudo cargar los tokens de Telegram');
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

  // Deduplicate by address (keep first/oldest) + sort by detection time (newest first)
  const seen = new Set();
  const list = (tokens || [])
    .slice()
    .sort((a, b) => (a.detectedAt || 0) - (b.detectedAt || 0)) // oldest first
    .filter((t) => {
      if (seen.has(t.address)) return false;
      seen.add(t.address);
      return true;
    })
    .sort((a, b) => (b.detectedAt || 0) - (a.detectedAt || 0)); // then newest first for display

  const handleTokenPress = (t) => {
    if (onTokenPress) {
      onTokenPress(t);
    } else {
      router.push(`/(app)/(tabs)/index?ref=${encodeURIComponent(`solana:${t.address}`)}`);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await api.clearTelegramDetectedTokens();
      setTokens([]);
    } catch (e) {
      setError(e?.message || 'No se pudo limpiar');
    } finally {
      setClearing(false);
    }
  };

  const openOnFomo = async (t) => {
    const url = `https://fomo.family/tokens/solana/${t.address}`;
    try { await Linking.openURL(url); } catch {}
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={k.scroll}>
      <View style={k.headRow}>
        <SectionHeader title="Tokens de Telegram" count={list.length} />
        <Pressable style={({ pressed }) => [k.clearBtn, pressed && k.pressed]} onPress={clearAll} disabled={clearing}>
          <Text style={k.clearBtnText}>{clearing ? '...' : 'Limpiar'}</Text>
        </Pressable>
      </View>

      {status && !status.connected && (
        <Notice kind="err" text={status.lastError || 'Cliente de Telegram no conectado. Configúralo en el server.'} />
      )}

      {error ? <Notice kind="err" text={error} /> : null}

      {tokens == null && !error && (
        <View style={k.loading}>
          <ActivityIndicator color={C.paper} />
        </View>
      )}

      {tokens != null && list.length === 0 && !error && (
        <View style={k.empty}>
          <Text style={k.emptyTitle}>Sin tokens detectados</Text>
          <Text style={k.emptySub}>
            {status && !status.connected
              ? 'El cliente de Telegram no está conectado.'
              : 'Esperando mensajes con direcciones de tokens en los canales suscritos...'}
          </Text>
        </View>
      )}

      {list.map((t) => (
        <View key={t.id} style={k.card}>
          <Pressable style={k.cardMain} onPress={() => handleTokenPress(t)}>
            <Avatar symbol={t.symbol || '?'} chainId="solana" address={t.address} size={34} imageUrl={t.logo} />
            <View style={k.cardInfo}>
              <View style={k.symbolRow}>
                <Text style={k.cardSymbol}>{t.symbol || t.address.slice(0, 8)}</Text>
                {t.ageMinutes != null ? (
                  <Text style={k.cardAge}>{t.ageMinutes}m</Text>
                ) : null}
              </View>
              <Text numberOfLines={1} style={k.cardName}>{t.name || 'Token desconocido'}</Text>
              <View style={k.cardMeta}>
                <Text style={k.cardTime}>{formatTime(t.detectedAt)}</Text>
                {t.axiomCallouts > 0 ? (
                  <Text style={k.cardAxiom}>Axiom: {t.axiomCallouts}</Text>
                ) : null}
                {t.fomoTraders > 0 ? (
                  <Text style={k.cardFomo}>FOMO: {t.fomoTraders}</Text>
                ) : null}
                {t.kolTraders > 0 ? (
                  <Text style={k.cardKol}>KOL: {t.kolTraders}</Text>
                ) : null}
                {t.communityCallouts > 0 ? (
                  <Text style={k.cardCommunity}>GMGNC: {t.communityCallouts}</Text>
                ) : null}
                {t.pumpTraders > 0 ? (
                  <Text style={k.cardPump}>Pump: {t.pumpTraders}</Text>
                ) : null}
                {t.axiomTraders > 0 ? (
                  <Text style={k.cardAxiomTraders}>AxiomT: {t.axiomTraders}</Text>
                ) : null}
              </View>
            </View>
            <View style={k.cardStats}>
              <Text style={k.cardStatLabel}>Market cap</Text>
              <Text style={k.cardStatValue}>{t.marketCapUsd ? formatCompactUsd(t.marketCapUsd) : '—'}</Text>
              {t.entryMarketCapUsd && t.entryMarketCapUsd !== t.marketCapUsd ? (
                <Text style={k.cardEntry}>Entry: {formatCompactUsd(t.entryMarketCapUsd)}</Text>
              ) : null}
              {t.mcChangePct != null ? (
                <Text style={[k.cardChange, { color: t.mcChangePct >= 0 ? C.green : C.red }]}>
                  {t.mcChangePct >= 0 ? '+' : ''}{t.mcChangePct.toFixed(1)}%
                </Text>
              ) : null}
            </View>
          </Pressable>
          <Pressable style={({ pressed }) => [k.linkBtn, pressed && k.pressed]} onPress={() => openOnFomo(t)}>
            <Text style={k.linkText}>↗</Text>
          </Pressable>
        </View>
      ))}

      <Text style={k.foot}>Tokens detectados en canales de Telegram · precios en vivo · se actualiza cada 2s</Text>
    </ScrollView>
  );
}

const k = StyleSheet.create({
  scroll: { paddingHorizontal: 12, paddingBottom: 24 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4, marginBottom: 4 },
  loading: { padding: 22, alignItems: 'center' },
  empty: { alignItems: 'center', padding: 22 },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  emptySub: { color: C.text3, fontSize: 13, marginTop: 4, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, gap: 10, marginBottom: 6 },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardInfo: { flex: 1, minWidth: 0 },
  symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardSymbol: { color: C.text, fontSize: 15, fontWeight: '700' },
  cardAge: { color: C.text3, fontSize: 11, fontWeight: '600' },
  cardName: { color: C.text2, fontSize: 11, marginTop: 1 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
  cardChannel: { color: C.paper, fontSize: 11, fontWeight: '600', flex: 1 },
  cardTime: { color: C.text3, fontSize: 10 },
  cardStats: { alignItems: 'flex-end', minWidth: 60 },
  cardStatLabel: { color: C.text3, fontSize: 9, textTransform: 'uppercase', marginBottom: 2 },
  cardStatValue: { color: C.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardEntry: { color: C.text3, fontSize: 10, marginTop: 2 },
  cardChange: { fontSize: 10, marginTop: 2, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardPrice: { color: C.text3, fontSize: 10, marginTop: 2, fontVariant: ['tabular-nums'] },
  cardAxiom: { color: C.paper, fontSize: 10, marginTop: 2, fontWeight: '600' },
  cardFomo: { color: '#3b82f6', fontSize: 10, marginTop: 2, fontWeight: '600' },
  cardKol: { color: '#f59e0b', fontSize: 10, marginTop: 2, fontWeight: '600' },
  cardCommunity: { color: C.green, fontSize: 10, marginTop: 2, fontWeight: '600' },
  cardPump: { color: C.green, fontSize: 10, marginTop: 2, fontWeight: '600' },
  cardAxiomTraders: { color: C.paper, fontSize: 10, marginTop: 2, fontWeight: '600' },
  linkBtn: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg3 },
  linkText: { color: C.text2, fontSize: 14 },
  foot: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 10 },
  clearBtn: { backgroundColor: C.bg3, borderRadius: 8, borderWidth: 1, borderColor: C.lineStrong, paddingHorizontal: 10, paddingVertical: 4 },
  clearBtnText: { color: C.text2, fontSize: 12, fontWeight: '600' },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});