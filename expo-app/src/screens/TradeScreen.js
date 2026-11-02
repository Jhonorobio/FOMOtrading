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
  const [side, setSide] = useState('BUY'); // 'BUY' | 'SELL'
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

  const presets = [10, 100, 500, 1000];
  const [selectedPreset, setSelectedPreset] = useState(null);

  const handlePreset = (val) => {
    setSelectedPreset(val);
    setAmount(String(val));
  };

  const handleMax = () => {
    if (!account || !quote) return;
    const available = account.cashBalance;
    setAmount(String(Math.floor(available * 100) / 100));
    setSelectedPreset(null);
  };

  const placeTrade = async () => {
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
      setSelectedPreset(null);
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
      {/* Header: buscador */}
      <View style={styles.searchBar}>
        <View style={styles.searchInputWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="https://fomo.family/tokens/solana/…"
            value={asset.address}
            onChangeText={onAddressChange}
            autoCapitalize="none"
            spellCheck={false}
          />
        </View>
        <TouchableOpacity style={styles.loadBtn} onPress={() => {}}>
          <Text style={styles.loadBtnText}>Load</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.note}>
        <Text style={styles.noteText}>Or <Text style={styles.noteLink}>open fomo.family</Text> and pick a token. It shows up here automatically.</Text>
      </View>

      {/* Buy / Sell tabs */}
      <View style={styles.buySellWrap}>
        <TouchableOpacity
          style={[styles.buySellBtn, side === 'BUY' && styles.buySellActive]}
          onPress={() => setSide('BUY')}
        >
          <Text style={[styles.buySellText, side === 'BUY' && styles.buySellTextActive]}>Buy</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.buySellBtn, side === 'SELL' && styles.buySellActive]}
          onPress={() => setSide('SELL')}
        >
          <Text style={[styles.buySellText, side === 'SELL' && styles.buySellTextActive]}>Sell</Text>
        </TouchableOpacity>
      </View>

      {/* Big amount display */}
      <View style={styles.amountCard}>
        <View style={styles.amountBig}>
          <Text style={styles.amountBigCurrency}>$</Text>
          <Text style={styles.amountBigValue}>{amount ? Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0'}</Text>
        </View>
        <View style={styles.amountPlaceholder}>
          <Text style={styles.amountPlaceholderText}>Enter amount</Text>
        </View>
      </View>

      {/* Presets */}
      <View style={styles.presetsRow}>
        {presets.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.presetBtn, selectedPreset === p && styles.presetBtnActive]}
            onPress={() => handlePreset(p)}
          >
            <Text style={[styles.presetText, selectedPreset === p && styles.presetTextActive]}>
              ${p}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.presetBtn, selectedPreset === null && styles.presetBtnActive]}
          onPress={handleMax}
        >
          <Text style={[styles.presetText, selectedPreset === null && styles.presetTextActive]}>Max</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.settingsBtn} onPress={() => {}}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Available balance */}
      <View style={styles.availableRow}>
        <Text style={styles.availableText}>
          {account ? account.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'} available
        </Text>
      </View>

      {/* Token selector */}
      <View style={styles.tokenSelector}>
        <TouchableOpacity style={styles.tokenSelectorWrap} onPress={() => {}}>
          <Text style={styles.tokenSelectorText}>Select a token</Text>
          <Text style={styles.tokenSelectorBadge}>PAPER</Text>
        </TouchableOpacity>
      </View>

      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusIconWrap}>
          <Text style={styles.statusIcon}>📄</Text>
        </View>
        <View style={styles.statusTextWrap}>
          <Text style={styles.statusTitle}>Paper trading - no token selected</Text>
          <Text style={styles.statusSub}>Simulated fills at live prices - no real funds</Text>
        </View>
        <View style={styles.statusChevron}>
          <Text style={styles.statusChevronText}>▾</Text>
        </View>
      </View>

      {/* Quote preview */}
      {quote && (
        <View style={styles.quoteRow}>
          <Avatar symbol={quote.symbol || '?'} chainId={quote.chainId || 'solana'} address={quote.address} size={32} />
          <View style={styles.quoteInfo}>
            <Text style={styles.quoteSymbol}>{quote.symbol || '?'}</Text>
            <Text style={styles.quotePrice}>${Number(quote.priceUsd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 8 })}</Text>
          </View>
        </View>
      )}

      {/* Message banner */}
      {message && (
        <View style={styles.bannerOk}>
          <Text style={styles.bannerText}>{message}</Text>
        </View>
      )}

      {/* Buy / Sell actions */}
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

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPrimary },
  content: { paddingHorizontal: 16, paddingBottom: 24 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Platform.OS === 'ios' ? 40 : 20,
    marginBottom: 12,
    backgroundColor: '#0a0a12',
    borderRadius: 12,
    overflow: 'hidden',
    height: 48,
    borderWidth: 1,
    borderColor: 'rgba(203, 208, 235, 0.09)',
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  searchIcon: {
    color: '#9899a3',
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#f7f7f7',
    fontSize: 14,
    fontFamily: FONT,
    backgroundColor: 'transparent',
    paddingVertical: 12,
  },
  loadBtn: {
    backgroundColor: '#12111a',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(203, 208, 235, 0.09)',
  },
  loadBtnText: {
    color: '#f7f7f7',
    fontWeight: '700',
    fontSize: 14,
    fontFamily: FONT,
  },

  note: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  noteText: {
    color: '#9899a3',
    fontSize: 13,
    fontFamily: FONT,
  },
  noteLink: {
    color: '#a896ff',
    fontWeight: '600',
    fontFamily: FONT,
  },

  buySellWrap: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  buySellBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: '#12111a',
    borderWidth: 1,
    borderColor: 'rgba(203, 208, 235, 0.09)',
  },
  buySellActive: {
    backgroundColor: '#21c95e',
    borderColor: 'transparent',
  },
  buySellText: {
    color: '#9899a3',
    fontWeight: '700',
    fontSize: 16,
    fontFamily: FONT,
  },
  buySellTextActive: {
    color: '#060510',
  },

  amountCard: {
    backgroundColor: '#12111a',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(203, 208, 235, 0.09)',
    position: 'relative',
  },
  amountBig: {
    position: 'absolute',
    top: 16,
    left: 16,
  },
  amountBigCurrency: {
    color: '#f7f7f7',
    fontSize: 34,
    fontWeight: '700',
    fontFamily: FONT,
  },
  amountBigValue: {
    color: '#f7f7f7',
    fontSize: 34,
    fontWeight: '700',
    fontFamily: FONT,
  },
  amountPlaceholder: {
    position: 'absolute',
    bottom: 16,
    right: 16,
  },
  amountPlaceholderText: {
    color: '#9899a3',
    fontSize: 14,
    fontFamily: FONT,
  },

  presetsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  presetBtn: {
    width: 64,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#12111a',
    borderWidth: 1,
    borderColor: 'rgba(203, 208, 235, 0.09)',
  },
  presetBtnActive: {
    backgroundColor: '#21c95e',
    borderColor: 'transparent',
  },
  presetText: {
    color: '#f7f7f7',
    fontWeight: '700',
    fontSize: 14,
    fontFamily: FONT,
  },
  presetTextActive: {
    color: '#060510',
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#12111a',
    borderWidth: 1,
    borderColor: 'rgba(203, 208, 235, 0.09)',
  },
  settingsIcon: {
    fontSize: 18,
    color: '#9899a3',
  },

  availableRow: {
    marginBottom: 12,
  },
  availableText: {
    color: '#f7f7f7',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FONT,
  },

  tokenSelector: {
    marginBottom: 12,
  },
  tokenSelectorWrap: {
    backgroundColor: '#12111a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(203, 208, 235, 0.09)',
  },
  tokenSelectorText: {
    color: '#f7f7f7',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONT,
  },
  tokenSelectorBadge: {
    backgroundColor: '#1a1730',
    color: '#a896ff',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },

  statusBar: {
    backgroundColor: '#1a1730',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(203, 208, 235, 0.09)',
  },
  statusIconWrap: {
    marginRight: 12,
  },
  statusIcon: {
    fontSize: 20,
    color: '#a896ff',
  },
  statusTextWrap: {
    flex: 1,
  },
  statusTitle: {
    color: '#f7f7f7',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FONT,
  },
  statusSub: {
    color: '#9899a3',
    fontSize: 12,
    fontFamily: FONT,
    marginTop: 2,
  },
  statusChevron: {
    justifyContent: 'center',
  },
  statusChevronText: {
    color: '#a896ff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONT,
  },

  quoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  quoteInfo: { marginLeft: 10, minWidth: 0 },
  quoteSymbol: {
    color: '#f7f7f7',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONT,
  },
  quotePrice: {
    color: '#9899a3',
    fontSize: 12,
    fontFamily: FONT,
    marginTop: 2,
  },

  bannerOk: {
    backgroundColor: 'rgba(33, 201, 94, 0.14)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    alignItems: 'center',
  },
  bannerText: {
    color: '#21c95e',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT,
  },

  actions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnBuy: {
    backgroundColor: '#21c95e',
  },
  btnSell: {
    backgroundColor: '#ff622e',
  },
  btnText: {
    color: '#060510',
    fontSize: 15,
    fontWeight: '800',
    fontFamily: FONT,
  },

  spacer: { height: 20 },
});
