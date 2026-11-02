import TokensFeed from '../../../components/TokensFeed';
import { Screen } from '../../../components/ui';

export default function GraduadosScreen() {
  return (
    <Screen title="Graduados">
      <TokensFeed mode="graduados" />
    </Screen>
  );
}
