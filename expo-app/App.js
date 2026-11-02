import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform, Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';

import { setServerUrl } from './src/services/api.js';
import { registerForPushNotificationsAsync } from './src/services/notifications.js';
import { COLORS, FONT } from './src/theme.js';

import TradeScreen from './src/screens/TradeScreen';
import PortfolioScreen from './src/screens/PortfolioScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import StyleScreen from './src/screens/StyleScreen';
import TokensScreen from './src/screens/TokensScreen';

const Tab = createBottomTabNavigator();

const TABS = [
  { name: 'Trade', component: TradeScreen, icon: 'trending-up', color: '#a896ff' },
  { name: 'Portfolio', component: PortfolioScreen, icon: 'pie-chart', color: '#a896ff' },
  { name: 'History', component: HistoryScreen, icon: 'list', color: '#a896ff' },
  { name: 'Style', component: StyleScreen, icon: 'bar-chart', color: '#a896ff' },
  { name: 'Tokens', component: TokensScreen, icon: 'cube', color: '#a896ff' },
];

export default function App() {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    (async () => {
      // Notificaciones push (opcional: no bloquea si Firebase no está configurado)
      try {
        await registerForPushNotificationsAsync();
      } catch (err) {
        console.warn('Push notifications no disponibles:', err.message);
      }

      // URL del servidor (cambia aquí si usas otro host, ej. Railway)
      const defaultUrl = Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';
      setServerUrl(defaultUrl);

      setInitialized(true);
    })();
  }, []);

  if (!initialized) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashText}>Paper Terminal</Text>
        <Text style={styles.splashSub}>Inicializando…</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => {
          const tab = TABS.find((t) => t.name === route.name);
          return {
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={tab.icon} size={size} color={focused ? tab.color : '#9899a3'} />
            ),
            tabBarActiveTintColor: '#a896ff',
            tabBarInactiveTintColor: '#9899a3',
            tabBarStyle: {
              backgroundColor: '#060510',
              borderTopColor: 'rgba(203, 208, 235, 0.09)',
              borderTopWidth: 1,
              height: Platform.OS === 'ios' ? 80 : 56,
              paddingTop: Platform.OS === 'ios' ? 10 : 0,
            },
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '700',
              fontFamily: 'Aeonik, Inter, ui-sans-serif, system-ui, sans-serif',
              marginTop: Platform.OS === 'ios' ? 2 : 0,
            },
            headerShown: false,
          };
        }}
      >
        {TABS.map((tab) => (
          <Tab.Screen key={tab.name} name={tab.name} component={tab.component} />
        ))}
      </Tab.Navigator>
      <StatusBar style="auto" />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#060510',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashText: {
    color: '#f7f7f7',
    fontSize: 24,
    fontWeight: '800',
    fontFamily: FONT,
  },
  splashSub: {
    color: '#9899a3',
    fontSize: 13,
    fontFamily: FONT,
    marginTop: 8,
  },
});
