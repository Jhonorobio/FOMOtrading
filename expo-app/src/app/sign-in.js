// Welcome / unlock screen — mirror of renderWelcome (sidepanel.js:362-384).
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useSession } from '../lib/session';
import { api, ApiError, signInWithCode, DEFAULT_SERVER_URL, getServerUrl, setServerUrl } from '../lib/api';
import { C } from '../lib/theme';
import { Notice } from '../components/ui';

export default function SignIn() {
  const { signIn } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverDraft, setServerDraft] = useState(getServerUrl());
  const [serverState, setServerState] = useState(null); // 'ok' | 'err'
  const [serverMsg, setServerMsg] = useState('');

  async function checkServer() {
    setServerState(null);
    setServerMsg('');
    api
      .health()
      .then((d) => {
        if (d && d.ok) {
          setServerState('ok');
          setServerMsg(`Connected · ${getServerUrl().replace(/^https?:\/\//, '')}`);
        } else {
          setServerState('err');
          setServerMsg('Server did not answer /api/health');
        }
      })
      .catch(() => {
        setServerState('err');
        setServerMsg(`Cannot reach ${getServerUrl().replace(/^https?:\/\//, '')}`);
      });
  }

  async function saveServer() {
    try {
      await setServerUrl(serverDraft);
      setServerState(null);
      setServerMsg('Saved.');
      setTimeout(checkServer, 100);
    } catch (e) {
      setServerState('err');
      setServerMsg(e?.message || 'Invalid URL');
    }
  }

  async function unlock() {
    setErr('');
    setBusy(true);
    try {
      await signInWithCode(code.trim());
      setUnlocked(true);
      setBusy(false);
      setTimeout(() => signIn('set'), 350);
    } catch (e) {
      setBusy(false);
      const detail = e?.message || e?.code || 'Connection failed';
      setErr(`${detail}${e?.code && e?.code !== 'NETWORK' ? ` · ${e.code}` : ''}${e?.status ? ` · HTTP ${e.status}` : ''}`);
    }
  }

  return (
    <View style={s.screen}>
      <View style={s.hero}>
        <View style={s.appIcon}>
          <Text style={s.appIconText}>P</Text>
        </View>
        <Text style={s.h1}>{unlocked ? 'Account unlocked.' : 'Practice on FOMO with paper money'}</Text>
        {!unlocked && <Text style={s.sub}>Same trading flow, virtual balance, a full record of every trade.</Text>}
      </View>

      {!unlocked && (
        <View style={s.body}>
          <Text style={s.label}>Access code</Text>
          <TextInput
            style={s.input}
            placeholder="FOMO"
            placeholderTextColor="#8a8c96"
            maxLength={20}
            autoCapitalize="characters"
            autoCorrect={false}
            value={code}
            onChangeText={setCode}
            onSubmitEditing={unlock}
          />
          <Text style={s.hint}>Enter the access code (FOMO or fomo) to unlock your personal paper account.</Text>

          <Notice kind="err" text={err} />

          <Pressable
            style={({ pressed }) => [s.cta, (!code.trim() || busy) && s.ctaDisabled, pressed && s.pressed]}
            disabled={!code.trim() || busy}
            onPress={unlock}>
            <Text style={s.ctaText}>{busy ? 'Unlocking…' : 'Unlock account'}</Text>
          </Pressable>

          <Pressable style={({ pressed }) => [s.serverToggle, pressed && s.pressed]} onPress={() => setServerOpen((v) => !v)}>
            <Text style={s.serverToggleText}>
              {serverOpen ? '▾' : '▸'} Server: {getServerUrl().replace(/^https?:\/\//, '')}
            </Text>
          </Pressable>
          {serverOpen && (
            <View style={s.serverPanel}>
              <TextInput
                style={s.input}
                value={serverDraft}
                onChangeText={setServerDraft}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder={DEFAULT_SERVER_URL}
                placeholderTextColor="#8a8c96"
              />
              <View style={s.serverRow}>
                <Pressable style={({ pressed }) => [s.serverBtn, pressed && s.pressed]} onPress={saveServer}>
                  <Text style={s.serverBtnText}>Save</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [s.serverBtn, pressed && s.pressed]} onPress={checkServer}>
                  <Text style={s.serverBtnText}>Test</Text>
                </Pressable>
              </View>
              {!!serverMsg && (
                <Text style={[s.serverMsg, (serverState === 'ok' && { color: C.green }) || (serverState === 'err' && { color: C.red })]}>{serverMsg}</Text>
              )}
              <Text style={s.hint}>
                On your PC run the server (cd server, npm start). From the phone use your PC LAN IP, like http://192.168.0.16:3001 — localhost refers to the phone itself.
              </Text>
            </View>
          )}

          <Text style={s.legal}>
            For 18s and over. By continuing you accept our Terms and Privacy policy.
          </Text>
          <Text style={s.legal}>
            Your paper account is separate from FOMO. We never ask for your FOMO login, wallet or keys.
          </Text>
        </View>
      )}

      <View style={s.spacer} />
      <Text style={s.footer}>Paper trading only. No wallet, no real orders, no real funds.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16 },
  hero: { alignItems: 'center', marginTop: 48 },
  appIcon: { width: 56, height: 56, borderRadius: 14, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  appIconText: { color: '#0b0918', fontSize: 24, fontWeight: '800' },
  h1: { color: C.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.02, textAlign: 'center', marginTop: 14, lineHeight: 28 },
  sub: { color: C.text2, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  body: { marginTop: 28 },
  label: { color: C.text2, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: { height: 40, borderRadius: 10, backgroundColor: C.bg2, borderColor: C.lineStrong, borderWidth: 1, color: C.text, paddingHorizontal: 12, fontSize: 14 },
  hint: { color: C.text3, fontSize: 11, marginTop: 8, lineHeight: 15 },
  cta: { height: 44, borderRadius: 10, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: C.bg, fontSize: 16, fontWeight: '700' },
  legal: { color: C.text3, fontSize: 12, marginTop: 14, lineHeight: 17 },
  spacer: { flex: 1 },
  footer: { color: C.text3, fontSize: 11, textAlign: 'center', paddingBottom: 6 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  serverToggle: { marginTop: 16, paddingVertical: 8 },
  serverToggleText: { color: C.text2, fontSize: 12, fontWeight: '600' },
  serverPanel: { marginTop: 8 },
  serverRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  serverBtn: { height: 34, borderRadius: 8, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.bg2, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  serverBtnText: { color: C.text, fontSize: 13, fontWeight: '700' },
  serverMsg: { marginTop: 8, fontSize: 12, color: C.text2 },
});
