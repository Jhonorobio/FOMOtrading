import TokensFeed from '../../../components/TokensFeed';
import { Screen } from '../../../components/ui';

export default function TrendingScreen() {
  return (
    <Screen title="Trending">
      <TokensFeed mode="trending" />
    </Screen>
  );
}
