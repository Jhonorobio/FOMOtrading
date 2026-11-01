import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';

import { api } from '../services/api.js';
import { COLORS, FONT } from '../theme.js';

export default function HistoryScreen() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = setInterval(load, 5000);
    load();
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    try {
      const d = await api.trades({});
      setTrades(d?.trades ?? []);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.sub}>Todas tus operaciones de papel</Text>
      </View>

      {!trades || trades.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No hay operaciones aún</Text>
          <Text style={styles.emptySub}>Compra o vende un token y aparecerá aquí.</Text>
        </View>
      ) : (
        trades.map((t) => (
          <View key={t.id} style={styles.row}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowSymbol}>{t.symbol}</Text>
              <Text style={styles.rowSide}>{t.side}</Text>
            </View>
            <View style={styles.rowValue}>
              <Text style={styles.rowAmount}>${t.total?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
              <Text style={[styles.rowPnl, t.realizedPnl >= 0 ? styles.up : styles.down]}>
                {t.realizedPnl !== null ? (t.realizedPnl >= 0 ? '+' : '') + t.realizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const Loading = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color={COLORS.paper} />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  header: { paddingTop: Platform.OS === 'ios' ? 56 : 24, paddingBottom: 16 },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '800', fontFamily: FONT },
  sub: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONT, marginTop: 4 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', fontFamily: FONT, marginBottom: 6 },
  emptySub: { color: COLORS.textSecondary, fontSize: 13, fontFamily: FONT, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  rowInfo: { flex: 1 },
  rowSymbol: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14, fontFamily: FONT },
  rowSide: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONT },
  rowValue: { alignItems: 'flex-end', minWidth: 140 },
  rowAmount: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13, fontFamily: FONT },
  rowPnl: { fontSize: 12, fontWeight: '700', fontFamily: FONT },
  up: { color: COLORS.green },
  down: { color: COLORS.red },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
