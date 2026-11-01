# 🚀 Inicio rápido — App Expo Paper Terminal (FOMO)

## 1. Requisitos

- Node.js >= 20
- Expo CLI (`npm i -g expo-cli` opcional, se usa `npx expo`)
- Servidor backend de la extensión ejecutándose (`server/src/index.js` en puerto 3001)

## 2. Instalar dependencias

Desde la carpeta del proyecto Expo:

```bash
cd c:\Users\ADMIN\Documents\TEACHER\FOMOtrading\expo-app
npm install
```

## 3. Iniciar el servidor backend

Asegúrate de que el servidor de la extensión esté corriendo (requerido para precios, tokens, cuenta de papel):

```bash
cd c:\Users\ADMIN\Documents\TEACHER\FOMOtrading\server
npm install   # solo la primera vez
npm start     # o node src/index.js
```

El servidor debe escuchar en `http://localhost:3001`.

> Si usas un dispositivo físico (no emulador), cambia la URL del servidor en `expo-app/App.js` o `expo-app/src/services/api.js` por la IP de tu computadora en la red local, por ejemplo `http://192.168.1.45:3001`.

## 4. Ejecutar la app

```bash
cd c:\Users\ADMIN\Documents\TEACHER\FOMOtrading\expo-app
npx expo start
```

- Presiona **a** para abrir en emulador Android
- Presiona **i** para abrir en simulador iOS
- Escanea el QR con la app **Expo Go** en tu dispositivo físico

> En emulador Android la URL por defecto apunta a `http://10.0.2.2:3001` (localhost del host).

## 5. Notificaciones push

La app ya está configurada con `expo-notifications`. Al abrirla por primera vez se te pedirá permiso para notificaciones.

Si quieres recibir notificaciones cuando llega un token nuevo a **Graduados**, necesitas un mecanismo que dispare `showNewTokenNotification` desde tu servidor o un webhook. Por ahora la app incluye:

- Registro de token Expo Push (`registerForPushNotificationsAsync`)
- Función `showNewTokenNotification({ symbol, address })` lista para usar

### Ejemplo de uso rápido (testing local)

En `src/screens/TokensScreen.js` podrías agregar, después de filtrar tokens nuevos, algo como:

```javascript
import { showNewTokenNotification } from '../services/notifications.js';
// ...
if (nuevoToken) {
  await showNewTokenNotification({ symbol: t.symbol, address: t.address });
}
```

## 6. Estructura del proyecto

```
expo-app/
├── App.js                      # Navegación por pestañas inferior + registro de push
├── app.json                    # Configuración de Expo
├── package.json
├── src/
│   ├── theme.js                # Colores idénticos al sidepanel (papal violet, dark bg)
│   ├── services/
│   │   ├── api.js              # Cliente REST contra el servidor Node.js (puerto 3001)
│   │   └── notifications.js    # expo-notifications: permisos, token push, notificaciones locales
│   ├── components/
│   │   └── Avatar.js           # Avatar circular con logo del servidor / fallback a letra
│   └── screens/
│       ├── TradeScreen.js      # Pegar dirección del memecoin + comprar/vender papel
│       ├── PortfolioScreen.js  # Equity, cash, posiciones abiertas
│       ├── HistoryScreen.js    # Historial de operaciones
│       ├── StyleScreen.js      # Estilo de trading + métricas + coaching
│       └── TokensScreen.js     # Graduados + Trending (orden por market cap)
```

## 7. Próximos pasos sugeridos

1. **Conectar el servidor real**: Si vas a desplegar en Railway u otro host, cambia `DEFAULT_SERVER_URL` en `src/services/api.js`.
2. **Notificaciones desde el backend**: Expón un endpoint en tu servidor Node que reciba el Expo Push Token y use `expo-server-sdk` para enviar push cuando aparezca un token nuevo en Mobula.
3. **Autenticación**: La app ya llama a `/api/auth/code` con el código `FOMO`; puedes agregar una pantalla de login sencilla.
