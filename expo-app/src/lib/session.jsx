// Session context — follows the Expo Router docs auth pattern:
// expo-secure-store on native, localStorage on web. Also carries the /api/me
// snapshot (needsSetup / needsConsent) used by the sign-in flow.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { use, createContext, useState, useEffect, useReducer, useCallback } from 'react';
import { bootApi, hasToken, saveToken, api, signOut as apiSignOut } from './api';

const ME_KEY = 'meSnapshot';

function useAsyncState(initial = [true, null]) {
  return useReducer((state, action = null) => [false, action], initial);
}

async function setItem(key, value) {
  if (Platform.OS === 'web') {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {}
  } else if (value == null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

function useStorageState(key) {
  const [state, setState] = useAsyncState();

  useEffect(() => {
    if (Platform.OS === 'web') {
      try {
        if (typeof localStorage !== 'undefined') setState(localStorage.getItem(key));
      } catch {}
    } else {
      SecureStore.getItemAsync(key).then((v) => setState(v));
    }
  }, [key]);

  const setValue = useCallback(
    (v) => {
      setState(v);
      setItem(key, v);
    },
    [key],
  );
  return [state, setValue];
}

const AuthContext = createContext(null);

const EMPTY_ME = { account: null, needsSetup: true, needsConsent: false };

export function SessionProvider({ children }) {
  const [[isLoading, token], setSession] = useStorageState('session');
  const [me, setMe] = useState(EMPTY_ME);
  const [meLoaded, setMeLoaded] = useState(false);

  useEffect(() => {
    Promise.all([bootApi(), SecureStore.getItemAsync('session')]).then(([, legacyToken]) => {
      // Keep the api module in sync: if the hook has a token but bootApi
      // found none under TOKEN_KEY, seed it.
      if (legacyToken && !hasToken()) saveToken(legacyToken);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!token) {
        await AsyncStorage.removeItem(ME_KEY).catch(() => {});
        if (!cancelled) {
          setMe(EMPTY_ME);
          setMeLoaded(true);
        }
        return;
      }
      try {
        const d = await api.me();
        if (cancelled) return;
        setMe(d);
        setMeLoaded(true);
        AsyncStorage.setItem(ME_KEY, JSON.stringify(d)).catch(() => {});
      } catch {
        if (cancelled) return;
        try {
          const cached = await AsyncStorage.getItem(ME_KEY);
          if (!cancelled && cached) {
            try {
              setMe(JSON.parse(cached));
            } catch {}
          }
        } catch {}
        if (!cancelled) setMeLoaded(true);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const value = {
    signIn: (sessionToken) => {
      setSession(sessionToken);
    },
    signOut: async () => {
      await apiSignOut();
      await AsyncStorage.removeItem(ME_KEY).catch(() => {});
      setMe(EMPTY_ME);
      setSession(null);
    },
    setMe,
    token,
    me,
    meLoaded,
    isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSession() {
  const value = use(AuthContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
