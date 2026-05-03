import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

import './src/i18n'; // initialise i18n

import { initDatabase } from './src/db/database';
import { networkOrchestrator } from './src/services/network/NetworkOrchestrator';
import { slmAdapter } from './src/services/llm/SLMAdapter';
import { useUserStore } from './src/store/userStore';
import {
  startRetryLoop,
  flushQueue,
} from './src/services/transmission/TransmissionService';
import { checkAndUpdateKnowledgeBase } from './src/services/knowledge/KnowledgeBaseUpdateService';

import SplashScreen from './src/screens/SplashScreen';
import RegistrationScreen from './src/screens/RegistrationScreen';
import HomeScreen from './src/screens/HomeScreen';
import ChatScreen from './src/screens/ChatScreen';
import TriageResultScreen from './src/screens/TriageResultScreen';

export type RootStackParamList = {
  Splash: undefined;
  Registration: undefined;
  Home: undefined;
  Chat: undefined;
  TriageResult: { triageLevel: 'RED' | 'AMBER' | 'GREEN'; triageReason: string; caseId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [isModelReady, setIsModelReady] = useState(false);
  const loadFromDatabase = useUserStore((s) => s.loadFromDatabase);

  useEffect(() => {
    async function bootstrap() {
      await initDatabase();
      await loadFromDatabase();

      networkOrchestrator.start();

      // Register connectivity-restored callback to flush queue
      networkOrchestrator.onConnectivityRestored(() => {
        flushQueue();
      });

      // Start retry loop in background
      startRetryLoop();

      // Check for knowledge base updates silently
      checkAndUpdateKnowledgeBase().catch(() => undefined);

      // Initialize SLM in background — don't block navigation
      slmAdapter.initialize().then(() => {
        setIsModelReady(slmAdapter.isModelReady());
      });
    }

    bootstrap();
  }, [loadFromDatabase]);

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{ headerStyle: { backgroundColor: '#0a0a0a' }, headerTintColor: '#ffffff' }}
      >
        <Stack.Screen name="Splash" options={{ headerShown: false }}>
          {(props) => <SplashScreen {...props} isModelReady={isModelReady} />}
        </Stack.Screen>

        <Stack.Screen
          name="Registration"
          component={RegistrationScreen}
          options={{ headerShown: false }}
        />

        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'MediReach', headerBackVisible: false }}
        />

        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={{ title: 'Assessment' }}
        />

        <Stack.Screen
          name="TriageResult"
          component={TriageResultScreen}
          options={{ headerShown: false, gestureEnabled: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
