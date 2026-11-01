import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';

import { api } from '../services/api.js';
import { COLORS, FONT } from '../theme.js';
import Avatar from '../components/Avatar.js';

export default function TradeScreen() {
  const [asset, setAsset] = useState({ chain: 'solana', address: '', symbol: '' });
  const [quote, setQuote] = useState(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [account, setAccount] = useState(null);

  useEffect(() => {
    loadAccount();
  }, []);

  const loadAccount = async () => {
    try {
      const data = await api.me();
      setAccount(data?.account ?? null);
    } catch {
      // cuenta no iniciada aún
    }
  };

  const fetchQuote = async () => {
    if (!asset.address) return;
    try {
      const data = await api.quote(asset.chain, asset.address);
      setQuote(data?.quote ?? null);
    } catch {
      setQuote(null);
    }
  };

  useEffect(() => {
    const id = setInterval(fetchQuote, 2000);
    return () => clearInterval(id);
  }, [asset.address]);

  const parseAddress = (text) => {
    const t = text.trim();
    if (!t) return { chain: 'solana', address: '', symbol: '' };
    // Si tiene formato chain:address
    if (t.includes(':')) {
      const [chain, address] = t.split(':');
      return { chain: chain.trim() || 'solana', address: address.trim(), symbol: '' };
    }
    return { chain: 'solana', address: t, symbol: '' };
  };

  const onAddressChange = (text) => {
    setAsset(parseAddress(text));
    setQuote(null);
  };

  const placeTrade = async (side) => {
    if (!account) {
      Alert.alert('Cuenta no iniciada', 'Primero inicia tu cuenta de papel desde Ajustes.');
      return;
    }
    if (!asset.address) {
      Alert.alert('Dirección requerida', 'Pega la dirección del token en el campo de arriba.');
      return;
    }
    const amt = Number(amount);
    if (!(amt > 0)) {
      Alert.alert('Monto inválido', 'Ingresa un monto en USD mayor a 0.');
      return;
    }
    if (!quote) {
      Alert.alert('Sin precio', 'Esperando precio en vivo del token...');
      return;
    }
    setBusy(true);
    try {
      await api.trade({
        chain: asset.chain,
        address: asset.address,
        side,
        amountUsd: amt,
        clientRequestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      setMessage(side === 'BUY' ? 'Compra simulada ejecutada' : 'Venta simulada ejecutada');
      setAmount('');
      await loadAccount();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      Alert.alert('Error', err.message || 'No se pudo ejecutar la operación');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      style={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Paper Trading</Text>
        <Text style={styles.headerSub}>Simulado · No hay fondos reales</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Dirección del token (Solana)</Text>
        <TextInput
          style={styles.input}
          placeholder="Pega la dirección del memecoin…"
          value={asset.address}
          onChangeText={onAddressChange}
          autoCapitalize="none"
          spellCheck={false}
        />
        <Text style={styles.hint}>Ejemplo: 2HESvwBr2AWD9rEdHLbcifCxXpJjnGThixT5zEonpump</HintText></TextInput>

        {quote && (
          <View style={styles.quoteRow}>
            <Avatar symbol={quote.symbol || '?'} chainId={quote.chainId || 'solana'} address={quote.address} size={32} />
            <View style={styles.quoteInfo}>
              <Text style={styles.quoteSymbol}>{quote.symbol || '?'}</Text>
              <Text style={styles.quotePrice}>${Number(quote.priceUsd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 8 })}</Text>
            </View>
          </View>
        )}

        <View style={styles.amountRow}>
          <Text style={styles.label}>Monto (USD)</Text>
          <TextInput
            style={styles.input}
            placeholder="100"
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
          />
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.btnBuy]}
            onPress={() => placeTrade('BUY')}
            disabled={busy || !account || !asset.address || !quote || !amount}
          >
            <Text style={styles.btnText}>COMPRAR</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSell]}
            onPress={() => placeTrade('SELL')}
            disabled={busy || !account || !asset.address || !quote || !amount}
          >
            <Text style={styles.btnText}>VENDER</Text>
          </TouchableOpacity>
        </View>

        {message && (
          <View style={styles.bannerOk}>
            <Text style={styles.bannerText}>{message}</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Cuenta de papel</Text>
        <View style={styles.accountRow}>
          <Text style={styles.accountLabel}>Saldo disponible</Text>
          <Text style={styles.accountValue}>${account ? account.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '--'}</Text>
        </View>
        <View style={styles.accountRow}>
          <Text style={styles.accountLabel}>Saldo inicial</Text>
          <Text style={styles.accountValue}>${account ? account.startingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '--'}</Text>
        </View>
      </View>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingBottom: 16,
  },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    fontFamily: FONT,
  },
  headerSub: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: FONT,
    marginTop: 4,
  },
  card: {
    backgroundColor: COLORS.bgSecondary,
    borderWidth: 1,
    borderColor: COLORS.lineStrong,
    borderRadius: COLORS.radius,
    padding: 14,
    marginBottom: 12,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.bgTertiarySolid,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: COLORS.radiusSm,
    color: COLORS.textPrimary,
    fontSize: 15,
    fontFamily: FONT,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  hint: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontFamily: FONT,
    marginTop: 4,
  },
  quoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
  },
  quoteInfo: { marginLeft: 10, minWidth: 0 },
  quoteSymbol: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONT,
  },
  quotePrice: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: FONT,
    marginTop: 2,
  },
  amountRow: { marginTop: 14 },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: COLORS.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnBuy: {
    backgroundColor: COLORS.green,
  },
  btnSell: {
    backgroundColor: COLORS.red,
  },
  btnText: {
    color: COLORS.bgPrimary,
    fontSize: 15,
    fontWeight: '800',
    fontFamily: FONT,
  },
  bannerOk: {
    backgroundColor: COLORS.greenT,
    borderRadius: COLORS.radiusSm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  bannerText: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  accountLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontFamily: FONT,
  },
  accountValue: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT,
  },
  spacer: { height: 20 },
});
