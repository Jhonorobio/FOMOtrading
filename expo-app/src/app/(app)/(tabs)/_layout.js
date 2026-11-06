// Bottom tab bar — icons + labels like the side panel nav (.nav chips),
// 6 entries: Trade / Portfolio / History / Style / Graduados / Trending.
// Icons: Ionicons (@expo/vector-icons), picked to match the web's Phosphor glyphs
// (wallet, history, trendUp, gear) from src/components/icons.js.
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../../lib/theme';

// [title, focused icon, unfocused (outline) icon]
const TAB_ICONS = {
  index: ['swap-horizontal', 'swap-horizontal-outline'],
  portfolio: ['wallet', 'wallet-outline'],
  history: ['time', 'time-outline'],
  style: ['color-palette', 'color-palette-outline'],
  graduados: ['school', 'school-outline'],
  photon: ['flash', 'flash-outline'],
  trending: ['trending-up', 'trending-up-outline'],
  settings: ['settings', 'settings-outline'],
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: C.text,
        tabBarInactiveTintColor: C.text2,
        tabBarStyle: { backgroundColor: C.bg2, borderTopColor: C.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon:
          TAB_ICONS[route.name] &&
          (({ focused, color }) => (
            <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={20} color={color} />
          )),
        tabBarHideOnKeyboard: true,
      })}>
      <Tabs.Screen name="index" options={{ title: 'Trade' }} />
      <Tabs.Screen name="portfolio" options={{ title: 'Portfolio' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="style" options={{ title: 'Style' }} />
      <Tabs.Screen name="graduados" options={{ title: 'Graduados' }} />
      <Tabs.Screen name="photon" options={{ title: 'Photon' }} />
      <Tabs.Screen name="trending" options={{ title: 'Trending' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
