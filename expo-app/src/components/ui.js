// Shared UI pieces: screen scaffold (topbar + footer note), segmented control,
// notice pill — copied from sidepanel.css metrics.
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { C, CARD } from '../lib/theme';

export function Screen({ title, right, children }) {
  return (
    <View style={styles.screen}>
      <View style={styles.topbar}>
        <View style={styles.brand}>
          <View style={styles.logoTile}>
            <Text style={styles.logoTileText}>P</Text>
          </View>
          <Text style={styles.wordmark}>Paper Terminal</Text>
        </View>
        {right}
      </View>
      {children}
      <Text style={styles.footer}>Paper trading only. No wallet, no real orders, no real funds.</Text>
    </View>
  );
}

export function Box({ pad = true, style, children, ...rest }) {
  return (
    <View style={[CARD, pad && styles.pad, style]} {...rest}>
      {children}
    </View>
  );
}

export function SectionHeader({ title, count }) {
  return (
    <View style={styles.sectionH}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {count != null && <Text style={styles.sectionCount}>{count}</Text>}
    </View>
  );
}

export function Seg({ options, value, onChange, style }) {
  return (
    <View style={[styles.seg, style]}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <Pressable
            key={i}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.segBtn, active && styles.segBtnActive, i > 0 && styles.segGap, pressed && styles.pressed]}>
            <Text style={[styles.segText, active && styles.segTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Notice({ kind = 'ok', text }) {
  if (!text) return null;
  return (
    <View
      style={[styles.notice, kind === 'ok' && styles.noticeOk, kind === 'err' && styles.noticeErr, kind === 'pink' && styles.noticePink]}>
      <Text
        style={[
          styles.noticeText,
          kind === 'ok' && { color: C.green },
          kind === 'err' && { color: C.red },
          kind === 'pink' && { color: C.paper },
        ]}>
        {text}
      </Text>
    </View>
  );
}

export function PasswordDots({ length }) {
  return null;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topbar: { height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoTile: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  logoTileText: { color: C.bg, fontSize: 15, fontWeight: '800' },
  wordmark: { color: C.text, fontSize: 15, fontWeight: '700', letterSpacing: -0.01 },
  footer: { color: C.text3, fontSize: 11, textAlign: 'center', paddingBottom: 6 },
  pad: { padding: 14 },
  sectionH: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 14, marginBottom: 8 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  sectionCount: { color: C.text2, fontSize: 13, fontVariant: ['tabular-nums'] },
  seg: { flexDirection: 'row', backgroundColor: C.bg2, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 3 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
  segBtnActive: { backgroundColor: C.bg3 },
  segGap: { marginLeft: 2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  segText: { color: C.text2, fontSize: 13, fontWeight: '600' },
  segTextActive: { color: C.text },
  notice: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, marginVertical: 8 },
  noticeOk: { backgroundColor: C.greenT, borderColor: 'transparent' },
  noticeErr: { backgroundColor: C.redT, borderColor: 'transparent' },
  noticePink: { backgroundColor: C.paperT, borderColor: C.paperLine },
  noticeText: { fontSize: 13, fontWeight: '500' },
});
