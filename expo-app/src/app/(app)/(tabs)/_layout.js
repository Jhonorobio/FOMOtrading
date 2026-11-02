// Bottom tab bar — text-only labels like the side panel nav (.nav chips),
// 6 entries: Trade / Portfolio / History / Style / Graduados / Trending.
import { Tabs } from 'expo-router';
import { C } from '../../../lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.text,
        tabBarInactiveTintColor: C.text2,
        tabBarStyle: { backgroundColor: C.bg2, borderTopColor: C.line },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        tabBarHideOnKeyboard: true,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Trade' }} />
      <Tabs.Screen name="portfolio" options={{ title: 'Portfolio' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="style" options={{ title: 'Style' }} />
      <Tabs.Screen name="graduados" options={{ title: 'Graduados' }} />
      <Tabs.Screen name="trending" options={{ title: 'Trending' }} />
    </Tabs>
  );
}
