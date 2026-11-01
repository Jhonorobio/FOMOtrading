import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  TouchableOpacity,
} from 'react-native';

import { api } from '../services/api.js';
import { COLORS, FONT } from '../theme.js';

const Loading = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color={COLORS.paper} />
  </View>
);

export default function PortfolioScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = setInterval(load, 2000);
    load();
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    try {
      const d = await api.portfolio();
      setData(d);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Loading />;

  const p = data?.performance ?? {};
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Portfolio</Text>
        <Text style={styles.sub}>Tu cuenta de papel en vivo</Text>
      </View>

      <View style={styles.equityCard}>
        <Text style={styles.equityLabel}>Equidad total</Text>
        <Text style={styles.equityValue}>${p.totalEquity?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
        <Text style={[styles.equityPnl, p.totalPnl >= 0 ? styles.up : styles.down]}>
          {(p.totalPnl >= 0 ? '+' : '')}${p.totalPnl?.toLocaleString(undefined, { minimumFractionDigits: 2 })} (
          {p.totalPnlPct?.toFixed(2)}%)
        </Text>
      </View>

      <View style={styles.grid}>
        <StatRow label="Cash" value={p.cash?.toLocaleString(undefined, { minimumFractionDigits: 2 })} />
        <StatRow label="Investido" value={p.invested?.toLocaleString(undefined, { minimumFractionDigits: 2 })} />
        <StatRow label="Hoy" value={p.todayPnl?.toLocaleString(undefined, { minimumFractionDigits: 2, sign: true })} />
        <StatRow label="No realizado" value={p.unrealizedPnl?.toLocaleString(undefined, { minimumFractionDigits: 2 })} />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Posiciones abiertas</Text>
        {(!data?.positions || data.positions.length === 0) && (
          <Text style={styles.empty}>No hay posiciones abiertas aún.</Text>
        )}
        {data?.positions?.map((pos) => (
          <View key={pos.address} style={styles.posRow}>
            <View style={styles.posInfo}>
              <Text style={styles.posSymbol}>{pos.symbol}</Text>
              <Text style={styles.posQty}>{pos.quantity?.toFixed(4)}</Text>
            </View>
            <View style={styles.posValue}>
              <Text style={styles.posMv}>${pos.marketValue?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
              <Text style={[styles.posPnl, pos.unrealizedPnl >= 0 ? styles.up : styles.down]}>
                {(pos.unrealizedPnl >= 0 ? '+' : '')}${pos.unrealizedPnl?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const StatRow = ({ label, value }) => (
  <View style={styles.statCard}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  header: { paddingTop: Platform.OS === 'ios' ? 56 : 24, paddingBottom: 16 },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '800', fontFamily: FONT },
  sub: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONT, marginTop: 4 },
  equityCard: {
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.lineStrong,
    borderRadius: COLORS.radius,
    padding: 16,
    marginBottom: 12,
  },
  equityLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', fontFamily: FONT },
  equityValue: { color: COLORS.textPrimary, fontSize: 26, fontWeight: '800', fontFamily: FONT, marginTop: 4 },
  equityPnl: { fontSize: 16, fontWeight: '700', fontFamily: FONT, marginTop: 6 },
  up: { color: COLORS.green },
  down: { color: COLORS.red },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  statCard: {
    flex: 1,
    minWidth: '48%',
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: COLORS.radiusSm,
    padding: 10,
  },
  statLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700', fontFamily: FONT },
  statValue: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700', fontFamily: FONT, marginTop: 4 },
  card: {
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.lineStrong,
    borderRadius: COLORS.radius,
    padding: 14,
    marginBottom: 12,
  },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', fontFamily: FONT, marginBottom: 10 },
  posRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  posInfo: { flex: 1 },
  posSymbol: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14, fontFamily: FONT },
  posQty: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONT },
  posValue: { alignItems: 'flex-end', minWidth: 120 },
  posMv: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13, fontFamily: FONT },
  posPnl: { fontSize: 12, fontWeight: '700', fontFamily: FONT },
  empty: { color: COLORS.textSecondary, fontSize: 13, fontFamily: FONT, textAlign: 'center', paddingVertical: 20 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
