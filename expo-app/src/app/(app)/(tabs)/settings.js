// Settings modal — mirror of the Settings bottom sheet (sidepanel.js).
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { api, DEFAULT_SERVER_URL, getServerUrl, setServerUrl } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { C } from '../../../lib/theme';
import { Screen, Box, Notice, SectionHeader } from '../../../components/ui';

const PRESETS = [1000, 5000, 10000, 25000, 50000, 100000];

export default function SettingsScreen() {
  const { signOut, me } = useSession();
  const router = useRouter();
  const [url, setUrl] = useState(getServerUrl());
  const [health, setHealth] = useState(null); // { ok } | null
  const [healthErr, setHealthErr] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState('pink');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [capital, setCapital] = useState(10000);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(async () => api.health())
      .then((d) => {
        if (alive) setHealth(d && d.ok ? d : null);
      })
      .catch((e) => {
        if (alive) {
          setHealth(null);
          setHealthErr(e?.message || 'Server unreachable');
        }
      });
    return () => {
      alive = false;
    };
  }, [url]);

  const flash = (text, kind = 'pink') => {
    setNotice(text);
    setNoticeKind(kind);
    setTimeout(() => setNotice(''), 6000);
  };

  async function saveUrl() {
    try {
      await setServerUrl(url);
      flash('Server url saved.');
    } catch (e) {
      flash(e?.message || 'Invalid URL', 'err');
    }
  }

  async function resetAccount() {
    if (!resetConfirm) {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 5000);
      return;
    }
    setBusy(true);
    try {
      const amt = custom ? Number(custom.replace(/[^0-9.]/g, '')) : capital;
      const d = await api.accountReset(amt);
      flash(`New paper account started with ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(d.account.cashBalance)}.`);
      setResetOpen(false);
      setResetConfirm(false);
      router.back();
    } catch (e) {
      flash(e?.message || 'Reset failed', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      setTimeout(() => setDeleteConfirm(false), 5000);
      return;
    }
    try {
      await api.accountDelete();
      await signOut();
    } catch (e) {
      flash(e?.message || 'Delete failed', 'err');
    }
  }

  async function telegramTest() {
    setTgBusy(true);
    try {
      await api.telegramTest();
      flash('Telegram test message sent.', 'ok');
    } catch (e) {
      flash(e?.message || 'Telegram test failed', 'err');
    } finally {
      setTgBusy(false);
    }
  }

  return (
    <Screen title="Settings">
      <ScrollView contentContainerStyle={st.scroll}>
        <Box pad={false} style={{ ...st.sheet, borderRadius: 0, borderWidth: 0 }}>
          <Text style={st.h2}>Settings</Text>
          <Text style={st.signedAs}>Signed in as {me?.userDisplayName || 'Paper Trader'}</Text>
        </Box>

        <SectionHeader title="Paper server" />
        <Box>
          <View style={st.serverRow}>
            <View style={[st.dot, health ? { backgroundColor: C.green, shadowColor: C.green } : { backgroundColor: C.red }]} />
            <Text style={st.serverText}>{health ? `Connected · market data live` : `Offline ${healthErr}`}</Text>
          </View>
          <Text style={st.serverUrl}>{getServerUrl().replace(/^https?:\/\//, '')}</Text>
          <Text style={st.label}>Server URL</Text>
          <TextInput
            style={st.input}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={DEFAULT_SERVER_URL}
            placeholderTextColor={C.text3}
          />
          <Pressable style={({ pressed }) => [st.btn, { backgroundColor: C.paper, marginTop: 10 }, pressed && st.pressed]} onPress={saveUrl}>
            <Text style={[st.btnText, { color: '#0b0918' }]}>Save URL</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [st.btn, { backgroundColor: C.bg3solid, marginTop: 6, opacity: tgBusy ? 0.5 : 1 }, pressed && st.pressed]} onPress={telegramTest} disabled={tgBusy}>
            <Text style={[st.btnText, { color: C.paper }]}>Test Telegram notification</Text>
          </Pressable>
        </Box>

        <SectionHeader title="Account" />
        <Box>
          <Text style={st.label}>Reset</Text>
          <Text style={st.sub}>Start over with new capital. Open positions close; earlier trades stay in History.</Text>
          <Pressable style={({ pressed }) => [st.btn, { backgroundColor: C.bg2, opacity: busy ? 0.5 : 1 }, resetConfirm && { backgroundColor: C.red, borderColor: 'transparent' }, pressed && st.pressed]} onPress={resetOpen ? resetAccount : () => setResetOpen(true)} disabled={busy}>
            <Text style={st.btnText}>{resetOpen ? (resetConfirm ? 'Tap again to confirm' : 'Reset account') : 'Reset…'}</Text>
          </Pressable>

          {resetOpen && (
            <View style={st.resetSheet}>
              <Text style={st.resetTitle}>Reset paper account</Text>
              <Text style={st.sub}>A new account starts with the capital you choose.</Text>
              <View style={st.capGrid}>
                {PRESETS.map((p) => {
                  const active = capital === p && !custom;
                  return (
                    <Pressable key={p} style={({ pressed }) => [st.capBtn, active && st.capBtnActive, pressed && st.pressed]} onPress={() => { setCapital(p); setCustom(''); }}>
                      <Text style={[st.capText, active && { color: C.paper }]}>${p >= 1000 ? `${p / 1000}K` : p}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={st.capCustom}>
                <Text style={st.capCustomDollar}>$</Text>
                <TextInput style={st.capCustomInput} value={custom} onChangeText={(t2) => setCustom(t2.replace(/[^0-9,]/g, ''))} placeholder="Custom amount…" placeholderTextColor={C.text3} keyboardType="number-pad" />
              </View>
              <Pressable style={({ pressed }) => [st.btn, { marginTop: 10 }, pressed && st.pressed]} onPress={() => setResetOpen(false)}>
                <Text style={st.btnText}>Cancel</Text>
              </Pressable>
            </View>
          )}

          <Text style={st.label}>Danger zone</Text>
          <Text style={st.sub}>Removes your profile, trades and history from the server. This cannot be undone.</Text>
          <Pressable style={({ pressed }) => [st.btn, { borderWidth: 1, borderColor: 'rgba(255,98,46,0.35)', backgroundColor: 'transparent' }, deleteConfirm && { backgroundColor: C.red, borderColor: 'transparent' }, pressed && st.pressed]} onPress={deleteAccount}>
            <Text style={[st.btnText, { color: C.red }, deleteConfirm && { color: '#060510' }]}>{deleteConfirm ? 'Tap again to confirm' : 'Delete account and data'}</Text>
          </Pressable>
        </Box>

        {notice ? <Notice kind={noticeKind} text={notice} /> : null}

        <Pressable style={({ pressed }) => [st.btn, { marginTop: 14, backgroundColor: C.text }, pressed && st.pressed]} onPress={signOut}>
          <Text style={[st.btnText, { color: C.bg }]}>Sign out</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [st.btn, { marginTop: 8, backgroundColor: C.bg2 }, pressed && st.pressed]} onPress={() => router.back()}>
          <Text style={st.btnText}>Done</Text>
        </Pressable>

        <Text style={st.foot}>Paper trading only. No wallet, no real orders, no real funds.</Text>
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  scroll: { paddingHorizontal: 12, paddingBottom: 24 },
  sheet: { padding: 4 },
  h2: { color: C.text, fontSize: 17, fontWeight: '700' },
  signedAs: { color: C.text2, fontSize: 13, marginTop: 2 },
  serverRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 8 },
  serverText: { color: C.text, fontSize: 14, fontWeight: '600' },
  serverUrl: { color: C.text2, fontSize: 12, marginTop: 4, marginBottom: 10 },
  label: { color: C.text2, fontSize: 12, fontWeight: '600', marginTop: 12 },
  sub: { color: C.text2, fontSize: 13, lineHeight: 18 },
  input: { height: 40, borderRadius: 10, backgroundColor: C.bg, borderColor: C.lineStrong, borderWidth: 1, color: C.text, paddingHorizontal: 12, fontSize: 13 },
  btn: { height: 40, borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.lineStrong, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  btnText: { color: C.text, fontSize: 14, fontWeight: '700' },
  resetSheet: { marginTop: 10, borderRadius: 10, backgroundColor: C.bg3solid, borderWidth: 1, borderColor: C.line, padding: 10 },
  resetTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  capGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  capBtn: { width: '31.5%', height: 48, borderRadius: 10, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg2, alignItems: 'center', justifyContent: 'center' },
  capBtnActive: { backgroundColor: C.paperT, borderColor: C.paperLine, borderWidth: 1.5 },
  capText: { color: C.text, fontSize: 16, fontWeight: '700' },
  capCustom: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 10, backgroundColor: C.bg2, borderColor: C.lineStrong, borderWidth: 1, marginTop: 12, paddingHorizontal: 14, gap: 6 },
  capCustomDollar: { color: C.text3, fontSize: 20, fontWeight: '600' },
  capCustomInput: { flex: 1, color: C.text, fontSize: 20, fontWeight: '600' },
  foot: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 16 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
