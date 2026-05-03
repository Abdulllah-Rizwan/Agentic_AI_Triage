import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Chat'>;
}

export default function ChatScreen({ navigation: _navigation }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Chat Screen — Coming in next task</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  text: { color: '#9ca3af', fontSize: 16 },
});
