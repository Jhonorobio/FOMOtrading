import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { COLORS, FONT } from '../theme.js';
import { api } from '../services/api.js';

/**
 * Avatar circular con logo del token (data: URL desde el servidor)
 * y fallback a la primera letra del símbolo si no hay logo.
 */
export default function Avatar({ symbol, chainId, address, size = 38 }) {
  const [logo, setLogo] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!chainId || !address) {
        setLoaded(true);
        return;
      }
      try {
        const data = await api.tokenLogo(chainId, address);
        if (!cancelled && data?.dataUrl) {
          setLogo(data.dataUrl);
        }
      } catch {
        // sin logo
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [chainId, address]);

  const letter = (symbol || '?').toString().replace(/^\$/, '').slice(0, 1).toUpperCase();

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: size / 2 }]}>
      {logo && loaded ? (
        <Image
          source={{ uri: logo }}
          style={styles.image}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.fallback}>
          <Text style={styles.letter}>{letter}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.bgTertiarySolid,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    color: COLORS.textSecondary,
    fontSize: Math.round(size * 0.4),
    fontWeight: '700',
    fontFamily: FONT,
  },
});
