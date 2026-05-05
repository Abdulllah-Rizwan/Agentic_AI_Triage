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
import { localRAG } from './src/services/rag/LocalRAG';

import SplashScreen from './src/screens/SplashScreen';
import RegistrationScreen from './src/screens/RegistrationScreen';
import HomeScreen from './src/screens/HomeScreen';
import ChatScreen from './src/screens/ChatScreen';
import TriageResultScreen from './src/screens/TriageResultScreen';
import type { TriageResult } from './src/services/triage/TriageEngine';
import type { MedicalFeatureVector } from './src/services/triage/TriageEngine';

export type RootStackParamList = {
  Splash: undefined;
  Registration: undefined;
  Home: undefined;
  Chat: undefined;
  TriageResult: { triageResult: TriageResult; featureVector: MedicalFeatureVector };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [isModelReady, setIsModelReady] = useState(false);
  const loadFromDatabase = useUserStore((s) => s.loadFromDatabase);

  useEffect(() => {
    async function bootstrap() {
      // 1. Database must be ready before anything reads/writes SQLite
      await initDatabase();

      // 2. Start network monitoring before loading user state
      networkOrchestrator.start();
      networkOrchestrator.onConnectivityRestored(() => {
        flushQueue();
      });

      // 3. Load user profile — determines Registration vs Home routing
      await loadFromDatabase();

      // 4. SLM load is ~5-15s — run in background, SplashScreen gates on isModelReady
      slmAdapter.initialize().then(() => {
        setIsModelReady(slmAdapter.isModelReady());
      });

      // 5. Pre-warm the local RAG index so first query is instant
      localRAG.initialize().catch(() => undefined);

      // 6. Check for knowledge base updates silently in background
      checkAndUpdateKnowledgeBase().catch(() => undefined);

      // 7. Start the transmission retry loop
      startRetryLoop();
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
