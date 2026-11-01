import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';

import { api } from '../services/api.js';
import { COLORS, FONT } from '../theme.js';
import Avatar from '../components/Avatar.js';

// Filtro defensivo: excluir tokens cuyo security solo tiene launchpadFeePercentage
function securityPasses(t) {
  const security = t?.security;
  if (!security) return true;
  const keys = Object.keys(security);
  if (keys.length === 1 && keys[0] === 'launchpadFeePercentage') return false;
  const otherKeys = keys.filter((k) => k !== 'launchpadFeePercentage');
  return otherKeys.some((k) => {
    const v = security[k];
    return v !== undefined && v !== null && v !== '' && v !== false;
  });
}

export default function TokensScreen() {
  const [tab, setTab] = useState('graduados'); // 'graduados' | 'trending'
  const [tokens, setTokens] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.tokens();
      const raw = data?.tokens ?? [];
      const filtered = raw.filter(securityPasses);
      setTokens(filtered);
      setError(null);
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
    const id = setInterval(fetchTokens, 2000);
    return () => clearInterval(id);
  }, [fetchTokens]);

  const displayTokens =
    tab === 'trending'
      ? [...tokens].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      : tokens;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Tokens descubiertos</Text>
        <View style={styles.subTabs}>
          <TouchableOpacity
            style={[styles.subTab, tab === 'graduados' && styles.subTabActive]}
            onPress={() => setTab('graduados')}
          >
            <Text style={[styles.subTabText, tab === 'graduados' && styles.subTabTextActive]}>
              Graduados
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.subTab, tab === 'trending' && styles.subTabActive]}
            onPress={() => setTab('trending')}
          >
            <Text style={[styles.subTabText, tab === 'trending' && styles.subTabTextActive]}>
              Trending
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={COLORS.paper} />
        </View>
      )}

      {error && <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>}

      {!loading && !error && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>{tab === 'trending' ? 'Trending' : 'Graduados'}</Text>
            <Text style={styles.sectionCount}>{displayTokens.length}</Text>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            style={styles.list}
          >
            {displayTokens.map((t) => (
              <TouchableOpacity key={t.address} style={styles.row} activeOpacity={0.7}>
                <Avatar symbol={t.symbol || '?'} chainId={t.chainId || 'solana'} address={t.address} size={40} />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowSymbol}>{t.symbol || '?'}</Text>
                  <Text style={styles.rowName}>{t.name || t.symbol || t.address.slice(0, 6).toUpperCase()}</Text>
                </View>
                <View style={styles.rowStats}>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Market cap</Text>
                    <Text style={styles.statValue}>${(t.marketCap ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Holders</Text>
                    <Text style={styles.statValue}>{(t.holders ?? 0).toLocaleString()}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {!loading && !error && displayTokens.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>
            {tab === 'trending' ? 'No hay tokens trending aún' : 'No hay tokens graduados aún'}
          </Text>
          <Text style={styles.emptySub}>El feed de descubrimiento de Mobula se está conectando.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  header: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 24,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONT,
  },
  subTabs: {
    flexDirection: 'row',
    marginTop: 8,
  },
  subTab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginRight: 8,
    backgroundColor: COLORS.bgTertiarySolid,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  subTabActive: {
    backgroundColor: COLORS.paperT,
    borderColor: COLORS.paperLine,
  },
  subTabText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT,
  },
  subTabTextActive: {
    color: COLORS.paper,
  },
  section: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT,
    textTransform: 'uppercase',
  },
  sectionCount: {
    color: COLORS.paper,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT,
  },
  list: { flex: 1 },
  listContent: { paddingBottom: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  rowInfo: { flex: 1, marginLeft: 10, minWidth: 0 },
  rowSymbol: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FONT,
  },
  rowName: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    fontFamily: FONT,
    marginTop: 2,
  },
  rowStats: {
    flexDirection: 'row',
    gap: 16,
  },
  statItem: { alignItems: 'flex-end' },
  statLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '500',
    fontFamily: FONT,
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT,
  },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorBanner: {
    padding: 16,
    backgroundColor: COLORS.redT,
    borderRadius: COLORS.radius,
    marginHorizontal: 16,
    marginTop: 12,
  },
  errorText: {
    color: COLORS.red,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FONT,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONT,
    textAlign: 'center',
    marginBottom: 6,
  },
  emptySub: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontFamily: FONT,
    textAlign: 'center',
  },
});
