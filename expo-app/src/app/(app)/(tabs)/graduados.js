import { router } from 'expo-router';
import TokensFeed from '../../../components/TokensFeed';
import { Screen } from '../../../components/ui';

export default function GraduadosScreen() {
  const onTokenPress = (t) => {
    router.push(`/(app)/(tabs)/index?ref=${encodeURIComponent(`${t.chainId}:${t.address}`)}`);
  };
  return (
    <Screen title="Graduados">
      <TokensFeed mode="graduados" onTokenPress={onTokenPress} />
    </Screen>
  );
}
