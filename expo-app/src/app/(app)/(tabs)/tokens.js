import { useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import TokensFeed from '../../../components/TokensFeed';
import PhotonGradsFeed from '../../../components/PhotonGradsFeed';
import { Screen, Seg } from '../../../components/ui';

// Module-level ref to pass the selected token to the Trade tab
export const pendingTokenRef = { current: null };

export default function TokensScreen() {
  const router = useRouter();
  const [tab, setTab] = useState('graduados');
  const onTokenPress = (t) => {
    pendingTokenRef.current = t;
    router.push('/(app)/(tabs)');
  };

  return (
    <Screen title="Tokens">
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
        <Seg
          options={[
            { value: 'graduados', label: 'Graduados' },
            { value: 'photon', label: 'Photon' },
            { value: 'trending', label: 'Trending' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      {tab === 'graduados' && <TokensFeed mode="graduados" onTokenPress={onTokenPress} />}
      {tab === 'photon' && <PhotonGradsFeed onTokenPress={onTokenPress} />}
      {tab === 'trending' && <TokensFeed mode="trending" onTokenPress={onTokenPress} />}
    </Screen>
  );
}
