import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Servicio de notificaciones push para la app Expo Paper Terminal.
 * Se encarga de:
 * 1. Solicitar permisos al usuario.
 * 2. Obtener el Expo Push Token (para enviarlo a tu servidor si deseas notificaciones desde el backend).
 * 3. Mostrar notificaciones locales cuando llegan tokens nuevos.
 */

// Cuando llegue una notificación mientras la app está en foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let expoPushToken = null;

export async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('graduados', {
      name: 'Nuevos tokens en Graduados',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#a896ff',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (finalStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('Permiso de notificaciones denegado');
    return null;
  }

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  expoPushToken = token;
  console.log('Expo Push Token:', token);
  return token;
}

export function getExpoPushToken() {
  return expoPushToken;
}

/**
 * Muestra una notificación local para un token nuevo en Graduados.
 * Llámala desde tu lógica de polling (o desde un webhook del servidor si lo conectas).
 */
export async function showNewTokenNotification({ symbol, address }) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Nuevo token en Graduados',
      body: `${symbol || address.slice(0, 6)}…`,
      data: { address },
    },
    trigger: null, // inmediato
  });
}
