import { useState } from 'react';
import { router } from 'expo-router';
import { View, Text } from 'react-native';
import PortfolioView from '../../../components/PortfolioView';
import StyleView from '../../../components/StyleView';
import { Screen, Seg } from '../../../components/ui';

export default function PortfolioStyleScreen() {
  const [tab, setTab] = useState('portfolio');

  return (
    <Screen
      title={tab === 'portfolio' ? 'Portfolio' : 'Style'}
      right={
        <Text onPress={() => router.push('/(app)/settings')} style={{ color: '#9899a3', fontSize: 20, padding: 6 }}>
          ⚙
        </Text>
      }>
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
        <Seg
          options={[
            { value: 'portfolio', label: 'Portfolio' },
            { value: 'style', label: 'Style' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      {tab === 'portfolio' && <PortfolioView />}
      {tab === 'style' && <StyleView />}
    </Screen>
  );
}
