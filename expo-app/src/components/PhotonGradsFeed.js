// Photon Graduados feed — the server's Photon memescope col3 poller, seen from
// the app. Mirrors TokensFeed (same row anatomy) plus a collapsible filters
// editor backed by GET/PUT /api/photon-grads/config (and a proxy tester).
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { api } from '../lib/api';
import { C } from '../lib/theme';
import { formatCompactUsd } from '../lib/format';
import { Box, SectionHeader, Notice } from './ui';
import Avatar from './Avatar';

const POLL_MS = 1000;

const FIELDS = [
  ['mktCap', 'MK (miles $)'],
  ['holders', 'Holders'],
  ['tpHolders', 'TP holders'],
  ['age', 'Edad (min)'],
  ['buys', 'Compras'],
  ['topHolders', 'Top holders %'],
  ['bundlePct', 'Bundle %'],
  ['bundleHolders', 'Bundle holders'],
  ['freshPct', 'Fresh %'],
];

const emptyForm = () => Object.fromEntries(FIELDS.map(([k]) => [k, { min: '', max: '' }]));

export default function PhotonGradsFeed({ onTokenPress }) {
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);

  // Filters editor state
  const [panelOpen, setPanelOpen] = useState(false);
  const [cfgLoaded, setCfgLoaded] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [enabled, setEnabled] = useState(true);
  const [proxy, setProxy] = useState('');
  const [ta, setTa] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [cfgError, setCfgError] = useState('');
  const [testMsg, setTestMsg] = useState(null); // { ok, text }

  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const d = await api.photonGrads();
        if (!alive) return;
        setTokens(d.tokens ?? []);
        // La frescura del último error se calcula en el tick (no en render,
        // Date.now es impuro para las reglas de hooks).
        const st = d.status ?? null;
        if (st?.lastError && Date.now() - st.lastError.at < 15000) st.freshError = st.lastError.message;
        else if (Number(st?.backoffRemainingMs) > 0) st.freshError = `backoff ${Math.ceil(st.backoffRemainingMs / 1000)}s`;
        else st.freshError = null;
        setStatus(st);
        setError('');
      } catch (e) {
        if (alive) setError(e?.message || 'El feed de Photon no está disponible');
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

  const loadConfig = async () => {
    try {
      const d = await api.photonGradsConfig();
      const f = d?.config?.filters?.col3 ?? {};
      setForm((prev) => {
        const next = emptyForm();
        for (const [key] of FIELDS) {
          next[key] = { min: f[key]?.min ? String(f[key].min) : '', max: f[key]?.max ? String(f[key].max) : '' };
        }
        return next;
      });
      setEnabled(d?.config?.enabled !== false);
      setProxy(d?.config?.proxy ?? '');
      setTa(d?.config?.ta ?? '');
      setCfgLoaded(true);
      setCfgError('');
    } catch (e) {
      setCfgError(e?.message || 'No se pudo cargar la configuración');
    }
  };

  const openPanel = () => {
    setPanelOpen((v) => {
      const next = !v;
      if (next && !cfgLoaded) loadConfig();
      return next;
    });
    setSavedMsg('');
    setTestMsg(null);
  };

  const setField = (key, side, value) => {
    setForm((prev) => ({ ...prev, [key]: { ...prev[key], [side]: value.replace(/[^\d.]/g, '') } }));
  };

  const filtersFromForm = () => {
    const out = {};
    for (const [key] of FIELDS) {
      const pair = form[key];
      if (pair?.min || pair?.max) out[key] = { min: pair.min, max: pair.max };
    }
    return out;
  };

  const save = async () => {
    setSaving(true);
    setSavedMsg('');
    setCfgError('');
    try {
      await api.setPhotonGradsConfig({ filters: filtersFromForm(), enabled, proxy: proxy.trim(), ta: ta.trim() });
      setSavedMsg('Filtros guardados ✔');
      setStatus(null); // refrescar el status de inmediato
      const d = await api.photonGradsConfig();
      setStatus(d?.status ?? null);
    } catch (e) {
      setCfgError(e?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const testProxy = async () => {
    setTestMsg(null);
    setSaving(true);
    try {
      const r = await api.photonGradsProxyTest({ proxy: proxy.trim(), ta: ta.trim(), filters: filtersFromForm() });
      setTestMsg(
        r?.ok
          ? `✔ Sin filtro funciona · ${r.tokens ?? 0} tokens · ${r.ms ?? '?'} ms`
          : `✖ ${r?.error || 'Sin respuesta'} (${r?.status ?? '—'})`,
      );
    } catch (e) {
      setTestMsg(`✖ ${e?.message || 'Error de red'}`);
    } finally {
      setSaving(false);
    }
  };

  const list = tokens || [];
  const visibleCount = list.filter((t) => t.visible !== false).length;
  const lastErr = status?.freshError ?? null;

  return (
    <ScrollView contentContainerStyle={k.scroll}>
      <View style={k.headRow}>
        <SectionHeader title="Photon Graduados" count={visibleCount} />
        <Pressable style={({ pressed }) => [k.filterBtn, pressed && k.pressed]} onPress={openPanel}>
          <Text style={k.filterBtnText}>{panelOpen ? 'Cerrar' : 'Filtros'}</Text>
        </Pressable>
      </View>

      {panelOpen ? (
        <Box style={k.panel}>
          <View style={k.segRow}>
            <Pressable
              style={({ pressed }) => [k.segBtn, enabled && k.segBtnActive, pressed && k.pressed]}
              onPress={() => setEnabled(true)}>
              <Text style={[k.segText, enabled && k.segTextActive]}>Activado</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [k.segBtn, !enabled && k.segBtnActive, pressed && k.pressed]}
              onPress={() => setEnabled(false)}>
              <Text style={[k.segText, !enabled && k.segTextActive]}>Pausado</Text>
            </Pressable>
          </View>

          <Text style={k.hint}>Mín/Máx (vacío = sin límite). El MK se escribe en miles (ej. 150 = $150K).</Text>
          {FIELDS.map(([key, label]) => (
            <View key={key} style={k.fRow}>
              <Text style={k.fLabel}>{label}</Text>
              <TextInput
                style={[k.fInput, form[key].min ? k.fInputActive : null]}
                value={form[key].min}
                onChangeText={(v) => setField(key, 'min', v)}
                placeholder="mín"
                placeholderTextColor={C.text3}
                keyboardType="numbers-and-punctuation"
              />
              <TextInput
                style={[k.fInput, form[key].max ? k.fInputActive : null]}
                value={form[key].max}
                onChangeText={(v) => setField(key, 'max', v)}
                placeholder="máx"
                placeholderTextColor={C.text3}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          ))}

          <Text style={[k.hint, k.hintGap]}>Proxy propio (vacío = el proxy compartido de Settings; sin nada = directo).</Text>
          <View style={k.proxyRow}>
            <TextInput
              style={k.proxyInput}
              value={proxy}
              onChangeText={setProxy}
              placeholder="http://host:puerto"
              placeholderTextColor={C.text3}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable style={({ pressed }) => [k.testBtn, pressed && k.pressed]} onPress={testProxy} disabled={saving}>
              <Text style={k.testBtnText}>Probar</Text>
            </Pressable>
          </View>

          <Text style={[k.hint, k.hintGap]}>Cookie _photon_ta (vacío = la del server). Si Photon contesta Unauthorized, pega la nueva desde DevTools en photon-sol.tinyastro.io.</Text>
          <TextInput
            style={k.proxyInput}
            value={ta}
            onChangeText={setTa}
            placeholder="cookie _photon_ta=..."
            placeholderTextColor={C.text3}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          {status?.unauthorized ? <Notice kind="err" text="Photon rechazó la cookie _photon_ta (Unauthorized). Pega una cookie nueva y guarda." /> : null}
          {testMsg ? <Notice kind={testMsg.ok ? 'ok' : 'err'} text={testMsg.text} /> : null}

          {cfgError ? <Notice kind="err" text={cfgError} /> : null}
          {savedMsg ? <Notice kind="ok" text={savedMsg} /> : null}

          <Pressable style={({ pressed }) => [k.saveBtn, saving && k.disabled, pressed && k.pressed]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={C.bg} /> : <Text style={k.saveBtnText}>Guardar</Text>}
          </Pressable>
        </Box>
      ) : null}

      {status?.enabled === false ? (
        <Notice kind="err" text="El poller está pausado en el servidor. Actívalo en Filtros." />
      ) : null}
      <Box pad={false} style={k.listBox}>
        {tokens == null && !error && (
          <View style={k.loading}>
            <ActivityIndicator color={C.paper} />
          </View>
        )}
        {error ? <Notice kind="err" text={error} /> : null}
        {tokens != null && list.length === 0 && !error && (
          <View style={k.empty}>
            <Text style={k.emptyTitle}>Sin tokens todavía</Text>
            <Text style={k.emptySub}>
              {lastErr ? `El poller reporta: ${lastErr}` : 'Esperando el primer pull de la columna Graduated de Photon…'}
            </Text>
          </View>
        )}
        {list.map((t) => {
          const rowContent = (
            <>
              <Avatar symbol={t.symbol} chainId={t.chainId} address={t.address} size={30} />
              <View style={k.rowMain}>
                <Text style={[k.rowSymbol, t.visible === false && k.dimmed]}>{t.symbol}</Text>
                <Text numberOfLines={1} style={[k.rowName, t.visible === false && k.dimmed]}>{t.name}</Text>
              </View>
              <View style={k.stat}>
                <Text style={k.statLabel}>Market cap</Text>
                <Text style={k.statValue}>{formatCompactUsd(t.marketCap)}</Text>
              </View>
              <View style={k.stat}>
                <Text style={k.statLabel}>Holders</Text>
                <Text style={k.statValue}>{t.holders != null ? Number(t.holders).toLocaleString('en-US') : '—'}</Text>
              </View>
              <View style={k.stat}>
                <Text style={k.statLabel}>Buys</Text>
                <Text style={k.statValue}>{t.buys != null ? Number(t.buys).toLocaleString('en-US') : '—'}</Text>
              </View>
            </>
          );
          return (
            <View key={t.address} style={k.row}>
              {onTokenPress ? (
                <Pressable style={k.row} onPress={() => onTokenPress(t)}>
                  {rowContent}
                </Pressable>
              ) : (
                rowContent
              )}
            </View>
          );
        })}
      </Box>
      <Text style={k.foot}>Feed en vivo · columna Graduated de Photon (1.3s) · los que entran avisan por Telegram</Text>
    </ScrollView>
  );
}

const k = StyleSheet.create({
  scroll: { paddingHorizontal: 12, paddingBottom: 24 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 },
  listBox: { padding: 8 },
  loading: { padding: 22, alignItems: 'center' },
  empty: { alignItems: 'center', padding: 22 },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  emptySub: { color: C.text3, fontSize: 13, marginTop: 4, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 8, gap: 8, marginBottom: 6 },
  rowMain: { flex: 1, minWidth: 60 },
  rowSymbol: { color: C.text, fontSize: 15, fontWeight: '700' },
  rowName: { color: C.text2, fontSize: 12 },
  dimmed: { opacity: 0.4 },
  stat: { width: 78, alignItems: 'flex-end' },
  statLabel: { color: C.text3, fontSize: 10, textTransform: 'uppercase' },
  statValue: { color: C.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  foot: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 10 },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  disabled: { opacity: 0.6 },
  // filters panel
  filterBtn: { backgroundColor: C.bg3, borderRadius: 10, borderWidth: 1, borderColor: C.lineStrong, paddingHorizontal: 12, paddingVertical: 6 },
  filterBtnText: { color: C.text, fontSize: 13, fontWeight: '600' },
  panel: { marginBottom: 10, marginTop: 2 },
  hint: { color: C.text3, fontSize: 11, marginBottom: 8 },
  hintGap: { marginTop: 4 },
  segRow: { flexDirection: 'row', backgroundColor: C.bg3, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 3, marginBottom: 10 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, borderRadius: 8 },
  segBtnActive: { backgroundColor: C.bg2 },
  segText: { color: C.text2, fontSize: 13, fontWeight: '600' },
  segTextActive: { color: C.text },
  fRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  fLabel: { flex: 1, color: C.text2, fontSize: 12 },
  fInput: { width: 74, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.line, borderRadius: 8, color: C.text, fontSize: 13, paddingHorizontal: 8, paddingVertical: 6 },
  fInputActive: { borderColor: C.paperLine },
  proxyRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  proxyInput: { flex: 1, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.line, borderRadius: 8, color: C.text, fontSize: 13, paddingHorizontal: 10, paddingVertical: 8 },
  testBtn: { backgroundColor: C.bg3, borderWidth: 1, borderColor: C.paperLine, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  testBtnText: { color: C.text, fontSize: 13, fontWeight: '600' },
  saveBtn: { backgroundColor: C.paper, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginTop: 4 },
  saveBtnText: { color: C.bg, fontSize: 15, fontWeight: '700' },
});
