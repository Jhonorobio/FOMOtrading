import { router } from 'expo-router';
import PhotonGradsFeed from '../../../components/PhotonGradsFeed';
import { Screen } from '../../../components/ui';

export default function PhotonGradsScreen() {
  const onTokenPress = (t) => {
    router.push(`/(app)/(tabs)/index?ref=${encodeURIComponent(`${t.chainId}:${t.address}`)}`);
  };
  return (
    <Screen title="Photon Graduados">
      <PhotonGradsFeed onTokenPress={onTokenPress} />
    </Screen>
  );
}
