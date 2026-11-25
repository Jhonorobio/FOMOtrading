// Telegram messages feed — captures messages from channels the user is subscribed to
// via the server's MTProto client. Polls GET /api/telegram/messages.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { api } from '../lib/api';
import { C } from '../lib/theme';
import { Box, SectionHeader, Notice } from './ui';

const POLL_MS = 5000;

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export default function TelegramMessagesFeed() {
  const [messages, setMessages] = useState(null);
  const [chats, setChats] = useState([]);
  const [error, setError] = useState('');
  const [selectedChat, setSelectedChat] = useState(null); // null = all
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const d = await api.telegramMessages({ limit: 50, chatId: selectedChat || undefined });
        if (!alive) return;
        setMessages(d.messages ?? []);
        setChats(d.chats ?? []);
        setError('');
        // status
        try {
          const st = await api.telegramStatus();
          if (alive) setStatus(st);
        } catch {}
      } catch (e) {
        if (alive) setError(e?.message || 'No se pudo cargar los mensajes de Telegram');
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [selectedChat]);

  const list = messages || [];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={k.scroll}>
      <View style={k.headRow}>
        <SectionHeader title="Mensajes Telegram" count={list.length} />
      </View>

      {status && !status.connected && (
        <Notice kind="err" text={status.lastError || 'Cliente de Telegram no conectado. Configura TELEGRAM_API_ID y TELEGRAM_API_HASH en el server.'} />
      )}

      {chats.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={k.chatFilterScroll} contentContainerStyle={k.chatFilterContent}>
          <Pressable
            style={({ pressed }) => [k.chatChip, !selectedChat && k.chatChipActive, pressed && k.pressed]}
            onPress={() => setSelectedChat(null)}>
            <Text style={[k.chatChipText, !selectedChat && k.chatChipTextActive]}>Todos</Text>
          </Pressable>
          {chats.map((c) => (
            <Pressable
              key={c.chatId}
              style={({ pressed }) => [k.chatChip, selectedChat === c.chatId && k.chatChipActive, pressed && k.pressed]}
              onPress={() => setSelectedChat(c.chatId)}>
              <Text style={[k.chatChipText, selectedChat === c.chatId && k.chatChipTextActive]} numberOfLines={1}>
                {c.chatTitle || c.chatId}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {error ? <Notice kind="err" text={error} /> : null}

      {messages == null && !error && (
        <View style={k.loading}>
          <ActivityIndicator color={C.paper} />
        </View>
      )}

      {messages != null && list.length === 0 && !error && (
        <View style={k.empty}>
          <Text style={k.emptyTitle}>Sin mensajes todavía</Text>
          <Text style={k.emptySub}>
            {status && !status.connected
              ? 'El cliente de Telegram no está conectado. Configúralo en el server.'
              : 'Esperando mensajes de los canales suscritos...'}
          </Text>
        </View>
      )}

      <Box pad={false} style={k.listBox}>
        {list.map((m) => (
          <View key={m.id} style={k.msgRow}>
            <View style={k.msgHeader}>
              <Text style={k.msgChat} numberOfLines={1}>{m.chatTitle || m.chatId}</Text>
              <Text style={k.msgTime}>{formatTime(m.date)}</Text>
            </View>
            {m.senderName && m.senderName !== 'Unknown' && (
              <Text style={k.msgSender}>{m.senderName}</Text>
            )}
            <Text style={k.msgText}>{m.text || (m.hasMedia ? `[${m.mediaType || 'media'}]` : '')}</Text>
          </View>
        ))}
      </Box>

      <Text style={k.foot}>Mensajes capturados de canales de Telegram · se actualiza cada 5s</Text>
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
  msgRow: { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, marginBottom: 6 },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  msgChat: { color: C.paper, fontSize: 12, fontWeight: '700', flex: 1 },
  msgTime: { color: C.text3, fontSize: 10 },
  msgSender: { color: C.text2, fontSize: 12, fontWeight: '600', marginBottom: 2 },
  msgText: { color: C.text, fontSize: 13, lineHeight: 18 },
  foot: { color: C.text3, fontSize: 11, textAlign: 'center', marginTop: 10 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  // chat filter chips
  chatFilterScroll: { marginBottom: 8 },
  chatFilterContent: { gap: 6, paddingHorizontal: 2 },
  chatChip: { borderRadius: 999, borderWidth: 1, borderColor: C.lineStrong, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: C.bg },
  chatChipActive: { backgroundColor: C.paperT, borderColor: C.paperLine },
  chatChipText: { color: C.text2, fontSize: 12, fontWeight: '600' },
  chatChipTextActive: { color: C.paper },
});