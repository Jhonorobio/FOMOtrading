// Token avatar — letter fallback like src/components/positions.js `avatar()`,
// hydrated with the server-provided logo data URL (/api/token-logo).
import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { Text } from 'react-native';
import { api } from '../lib/api';
import { C } from '../lib/theme';

const logos = new Map(); // "chain:address" -> dataUrl
const pending = new Map();
const listeners = new Map();

export function hydrateLogo(chainId, address, onReady) {
  const key = `${chainId}:${address}`;
  const cached = logos.get(key);
  if (cached !== undefined) {
    // already resolved: the component reads logos.get() directly during render
    return;
  }
  let list = listeners.get(key);
  if (!list) {
    list = new Set();
    listeners.set(key, list);
    pending.set(
      key,
      api
        .tokenLogo(chainId, address)
        .then((d) => {
          const url = d && d.dataUrl ? d.dataUrl : null;
          logos.set(key, url || '');
          list.forEach((cb) => url && cb(url));
        })
        .catch(() => {
          logos.set(key, '');
        })
        .finally(() => {
          pending.delete(key);
        }),
    );
  }
  list.add(onReady);
}

export default function Avatar({ symbol, chainId, address, size = 38 }) {
  const key = `${chainId}:${address}`;
  const [fetched, setFetched] = useState(null);
  const logo = logos.get(key) || fetched;

  useEffect(() => {
    let alive = true;
    const apply = (url) => {
      if (alive && url) setFetched(url);
    };
    hydrateLogo(chainId, address, apply);
    // do not read state synchronously: cached logos are read during render
    return () => {
      alive = false;
    };
  }, [chainId, address]);

  const letter = (symbol || '?').replace(/^\$/, '').toUpperCase().slice(0, 1);

  if (logo) {
    return (
      <Image
        source={{ uri: logo }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.bg3solid }}
        recyclingKey={`${chainId}:${address}`}
      />
    );
  }
  return (
    <Text
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: C.bg3solid,
        color: C.text2,
        fontSize: size * 0.39,
        fontWeight: '700',
        textAlign: 'center',
        textAlignVertical: 'center',
        lineHeight: size,
      }}>
      {letter}
    </Text>
  );
}
