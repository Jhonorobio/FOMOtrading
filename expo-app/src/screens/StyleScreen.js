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

export default function StyleScreen() {
  const [style, setStyle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = setInterval(load, 5000);
    load();
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    try {
      const d = await api.portfolio();
      setStyle(d?.tradingStyle ?? null);
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
        <Text style={styles.title}>Tu estilo de trading</Text>
        <Text style={styles.sub}>Basado en tus operaciones cerradas</Text>
      </View>

      {!style || style.sampleSize < 5 ? (
        <View style={styles.card}>
          <Text style={styles.label}>Desbloqueando tu estilo…</Text>
          <Text style={styles.empty}>
            Necesitas al menos {5} operaciones cerradas para obtener una lectura de estilo.
          </Text>
          <Text style={styles.emptySub}>{style?.sampleSize ?? 0} / {5} cerradas</Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Estilo</Text>
            <Text style={styles.styleName}>{style.style}</Text>
            <Text style={styles.styleDesc}>{style.styleDescription}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Métricas</Text>
            <View style={styles.grid}>
              <Stat label="Win rate" value={style.winRatePct?.toFixed(2)} suffix="%" />
              <Stat label="Profit factor" value={style.profitFactor?.toFixed(2)} />
              <Stat label="Expectancy" value={`$${style.expectancyUsd?.toFixed(2)}`} />
              <Stat label="Median hold" value={formatHold(style.medianHoldMs)} />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Coaching</Text>
            {style.insights?.map((insight, i) => (
              <View key={i} style={styles.insightRow}>
                <Text style={styles.insightDot}>•</Text>
                <Text style={styles.insightText}>{insight}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const formatHold = (ms) => {
  if (!ms) return '—';
  const h = ms / (1000 * 60 * 60);
  return h < 1 ? `${Math.round(ms / 60000)} min` : `${h.toFixed(1)} h`;
};

const Stat = ({ label, value, suffix }) => (
  <View style={styles.statCard}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value}{suffix ?? ''}</Text>
  </View>
);

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
  card: {
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.lineStrong,
    borderRadius: COLORS.radius,
    padding: 14,
    marginBottom: 12,
  },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', fontFamily: FONT, marginBottom: 8 },
  styleName: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800', fontFamily: FONT },
  styleDesc: { color: COLORS.textSecondary, fontSize: 13, fontFamily: FONT, marginTop: 6 },
  empty: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600', fontFamily: FONT, textAlign: 'center', marginTop: 10 },
  emptySub: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONT, textAlign: 'center', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: {
    flex: 1,
    minWidth: '48%',
    backgroundColor: COLORS.bgTertiarySolid,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: COLORS.radiusSm,
    padding: 10,
    alignItems: 'center',
  },
  statLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700', fontFamily: FONT },
  statValue: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '800', fontFamily: FONT, marginTop: 4 },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  insightDot: {
    color: COLORS.paper,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: FONT,
    marginRight: 8,
    marginTop: 1,
  },
  insightText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontFamily: FONT,
    flex: 1,
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
