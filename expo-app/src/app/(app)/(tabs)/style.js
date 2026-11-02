// STYLE TAB — mirror of renderStyle (sidepanel.js:799-867).
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Share } from 'react-native';
import { api } from '../../../lib/api';
import { C } from '../../../lib/theme';
import { formatUsd, formatSignedUsd, formatPct, formatDuration } from '../../../lib/format';
import { Screen, Box, Notice, SectionHeader } from '../../../components/ui';

const STYLE_SAMPLE = 5;

export default function StyleScreen() {
  const [style, setStyle] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .portfolio(new Date().getTimezoneOffset())
      .then((d) => alive && setStyle({ ...d, tradingStyle: d.tradingStyle || null }))
      .catch((e) => alive && setError(e?.message || 'Could not load style'));
    return () => {
      alive = false;
    };
  }, []);

  const n = style?.tradingStyle?.sampleSize || 0;
  const styleData = style?.tradingStyle;
  const unlocked = n >= STYLE_SAMPLE && styleData?.style;
  const bestTrade = style?.performance?.bestTrade || null;

  // 24-hour local activity from activityByHourUtc
  const localHours = useMemo(() => {
    const utc = styleData?.activityByHourUtc;
    if (!Array.isArray(utc) || utc.length !== 24) return null;
    const offsetH = -new Date().getTimezoneOffset() / 60;
    const local = new Array(24).fill(0);
    utc.forEach((c, h) => {
      local[(((h + offsetH) % 24) + 24) % 24] = c || 0;
    });
    return local;
  }, [styleData]);
  const maxHour = localHours ? Math.max(...localHours, 1) : 1;

  async function exportFile(format) {
    try {
      const text = await api.exportText(format);
      await Share.share({ message: text.slice(0, 4000) });
    } catch (e) {
      setNotice(e?.message || 'Export failed');
      setTimeout(() => setNotice(''), 5000);
    }
  }

  return (
    <Screen title="Style">
      <ScrollView contentContainerStyle={t.stylescroll}>
        <Text style={t.h1}>Style</Text>
        <Box>
          <View style={t.hero}>
            <View style={t.ringBox}>
              <View style={[t.ring, unlocked && { borderColor: C.paper }]}>
                <Text style={t.ringLabel}>{unlocked ? '✓' : `${n}/${STYLE_SAMPLE}`}</Text>
              </View>
            </View>
            <View style={t.heroMain}>
              <Text style={t.heroGutter}>Your trading style</Text>
              <Text style={t.heroTitle}>{unlocked ? styleData.style : `Close ${STYLE_SAMPLE - n} more trade${STYLE_SAMPLE - n === 1 ? '' : 's'}`}</Text>
              <Text style={t.heroSub}>
                {unlocked ? `Based on ${styleData.sampleSize || n} closed trades.` : 'After 5 closed trades you get a read on how you hold and size positions.'}
              </Text>
            </View>
          </View>
          <Text style={t.styleDesc}>{unlocked ? styleData.styleDescription : 'Your trading style unlock shows a read on how you hold and size positions.'}</Text>
        </Box>

        <SectionHeader title="Records" />
        <View style={t.bests}>
          <BestCard icon="🏆" label="Best trade" value={bestTrade ? formatSignedUsd(bestTrade.realizedPnl) : '—'} sub={bestTrade ? bestTrade.symbol : 'Not available yet'} />
          <BestCard icon="📈" label="Best return" value={styleData?.personalBests?.bestReturnPct != null ? formatPct(styleData.personalBests.bestReturnPct * 100) : '—'} sub="On closed trades" />
          <BestCard icon="🎯" label="Best trade %" value={bestTrade ? formatPct(bestTrade.returnPct * 100) : '—'} sub={bestTrade ? bestTrade.symbol : 'Not available yet'} />
        </View>

        <SectionHeader title="How you trade" />
        <Box pad={false} style={t.statGrid}>
          <Stat label="Median hold" value={styleData ? formatDuration(styleData.medianHoldMs) : '—'} />
          <Stat label="Win rate" value={styleData?.winRatePct != null ? formatPct(styleData.winRatePct, { signed: false }) : '—'} />
          <Stat label="Profit factor" value={styleData?.profitFactor != null ? String(styleData.profitFactor.toFixed(2)) : '—'} hint="Gross profit over gross loss" />
          <Stat label="Expectancy" value={styleData?.expectancyUsd != null ? formatSignedUsd(styleData.expectancyUsd) : '—'} hint="Average result per trade" />
          <Stat label="Average win" value={styleData?.averageWinUsd != null ? formatSignedUsd(styleData.averageWinUsd) : '—'} />
          <Stat label="Average loss" value={styleData?.averageLossUsd != null ? formatSignedUsd(-Math.abs(styleData.averageLossUsd)) : '—'} />
          <Stat label="Buy size" value={styleData?.averageBuyUsd != null ? formatUsd(styleData.averageBuyUsd) : '—'} hint={styleData?.averageBuyPctOfCash != null ? `${formatPct(styleData.averageBuyPctOfCash * 100, { signed: false })} of cash` : undefined} />
          <Stat label="Max drawdown" value={styleData?.maxRealizedDrawdownPct != null ? formatPct(-Math.abs(styleData.maxRealizedDrawdownPct)) : '—'} hint="On closed trades" />
        </Box>

        {(styleData?.insights?.length || 0) > 0 && (
          <>
            <SectionHeader title="Coaching" />
            <Box>
              {styleData.insights.map((txt, i) => (
                <View key={i} style={t.insight}>
                  <Text style={t.bolt}>⚡</Text>
                  <Text style={t.insightText}>{txt}</Text>
                </View>
              ))}
            </Box>
          </>
        )}

        <SectionHeader title="When you trade" />
        <Box>
          <Text style={t.localTime}>Local time</Text>
          <View style={t.hours}>
            {localHours ? (
              <View style={t.hoursRow}>
                {localHours.map((c, h) => (
                  <View key={h} style={t.hoursCol}>
                    <View style={[c > 0 ? t.hoursBar : t.hoursZero, { height: c > 0 ? Math.max(3, (c / maxHour) * 64) : 5 }]} />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          <Text style={t.hoursAxis}>00  06  12  18  23</Text>
        </Box>

        <SectionHeader title="Download history" />
        <Box>
          <Text style={t.exportDesc}>
            JSON has every fill, closed trades, open positions and these style metrics. CSV has one row per fill.
          </Text>
          <View style={t.exportRow}>
            <Pressable style={({ pressed }) => [t.btnSm, pressed && t.pressed]} onPress={() => exportFile('json')}>
              <Text style={t.btnSmText}>↓ JSON</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [t.btnSm, pressed && t.pressed]} onPress={() => exportFile('csv')}>
              <Text style={t.btnSmText}>↓ CSV</Text>
            </Pressable>
          </View>
        </Box>

        {error ? <Notice kind="err" text={error} /> : null}
        {notice ? <Notice kind="err" text={notice} /> : null}
      </ScrollView>
    </Screen>
  );
}

function BestCard({ icon, label, value, sub }) {
  return (
    <Box pad={false} style={t.bestsCard}>
      <Text style={t.bestsIcon}>{icon}</Text>
      <Text style={t.bestsLabel}>{label}</Text>
      <Text style={t.bestsValue}>{value}</Text>
      <Text style={t.bestsSub}>{sub}</Text>
    </Box>
  );
}

function Stat({ label: k, value, hint }) {
  return (
    <View style={t.statCell}>
      <Text style={t.statLabel}>{k}</Text>
      <Text style={[t.statValue, { color: String(value).startsWith('+') ? C.green : String(value).startsWith('−') || String(value).startsWith('-') ? C.red : C.text }]}>{value}</Text>
      {hint ? <Text style={t.statHint}>{hint}</Text> : null}
    </View>
  );
}

const t = StyleSheet.create({
  stylescroll: { paddingHorizontal: 12, paddingBottom: 24 },
  h1: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.02, marginBottom: 8 },
  hero: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  ringBox: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 76, height: 76, borderRadius: 76 / 2, borderWidth: 7, borderColor: C.bg3, alignItems: 'center', justifyContent: 'center' },
  ringLabel: { color: C.text, fontSize: 16, fontWeight: '700' },
  heroMain: { flex: 1 },
  heroGutter: { color: C.text2, fontSize: 12 },
  heroTitle: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.02 },
  heroSub: { color: C.text2, fontSize: 13, lineHeight: 18, marginTop: 2 },
  styleDesc: { color: C.text2, fontSize: 13, lineHeight: 18, marginTop: 10 },
  bests: { flexDirection: 'row', gap: 8 },
  bestsCard: { flex: 1, padding: 12, borderRadius: 12, borderColor: C.line },
  bestsIcon: { color: C.paper, fontSize: 16 },
  bestsLabel: { color: C.text2, fontSize: 12, marginTop: 4 },
  bestsValue: { color: C.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bestsSub: { color: C.text3, fontSize: 11 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  statCell: { width: '50%', padding: 11, borderColor: C.line, borderBottomWidth: 1, borderRightWidth: 1 },
  statLabel: { color: C.text2, fontSize: 12 },
  statValue: { color: C.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statHint: { color: C.text3, fontSize: 11, marginTop: 2 },
  insight: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  bolt: { color: C.paper, fontSize: 14 },
  insightText: { color: C.text, fontSize: 13, flex: 1, lineHeight: 18 },
  localTime: { color: C.text2, fontSize: 12 },
  hours: { height: 68, marginTop: 6 },
  hoursRow: { flexDirection: 'row', alignItems: 'flex-end', height: 64, gap: 2 },
  hoursCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  hoursBar: { backgroundColor: C.paper, opacity: 0.85, width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 3 },
  hoursZero: { backgroundColor: C.bg3, width: '100%', height: 5 },
  hoursAxis: { color: C.text3, fontSize: 10, marginTop: 6 },
  exportDesc: { color: C.text2, fontSize: 13, lineHeight: 18 },
  exportRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btnSm: { height: 34, borderRadius: 8, borderWidth: 1, borderColor: C.lineStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, backgroundColor: C.bg2 },
  btnSmText: { color: C.text, fontSize: 13, fontWeight: '700' },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
