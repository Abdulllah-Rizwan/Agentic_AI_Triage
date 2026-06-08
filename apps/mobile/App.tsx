import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { NavigationContainer, NavigationContainerRef, CommonActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

import './src/i18n';

import { initDatabase } from './src/db/database';
import { networkOrchestrator } from './src/services/network/NetworkOrchestrator';
import { slmAdapter } from './src/services/llm/SLMAdapter';
import { useUserStore } from './src/store/userStore';
import { sessionStore, SESSION_TIMEOUT_MS } from './src/store/sessionStore';
import {
  startRetryLoop,
  flushQueue,
} from './src/services/transmission/TransmissionService';
import { checkAndUpdateKnowledgeBase } from './src/services/knowledge/KnowledgeBaseUpdateService';
import { localRAG } from './src/services/rag/LocalRAG';
import {
  getLastActivityAt,
  setLastActivityAt,
} from './src/db/queries';

import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegistrationScreen from './src/screens/RegistrationScreen';
import HomeScreen from './src/screens/HomeScreen';
import ChatScreen from './src/screens/ChatScreen';
import TriageResultScreen from './src/screens/TriageResultScreen';
import AppointmentBookingScreen from './src/screens/AppointmentBookingScreen';
import type { TriageResult } from './src/services/triage/TriageEngine';
import type { MedicalFeatureVector } from './src/services/triage/TriageEngine';

export type RootStackParamList = {
  Splash: undefined;
  Login: undefined;
  Registration: undefined;
  Home: undefined;
  Chat: { readonlySession?: { caseId: string; triageLevel: string } } | undefined;
  TriageResult: { triageResult: TriageResult; featureVector: MedicalFeatureVector };
  AppointmentBooking: {
    caseId: string | null;
    chiefComplaint: string;
    triageLevel: string;
    patientName: string;
    patientPhone: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Navigation ref used for programmatic navigation outside of components
// (session timeout handler, AppState listener).
const navigationRef = React.createRef<NavigationContainerRef<RootStackParamList>>();

function navigateToLogin() {
  navigationRef.current?.dispatch(
    CommonActions.reset({ index: 0, routes: [{ name: 'Login' }] }),
  );
}

export default function App() {
  const [isModelReady, setIsModelReady] = useState(false);
  const loadFromDatabase = useUserStore((s) => s.loadFromDatabase);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    async function bootstrap() {
      // 1. DB must be ready before anything else reads/writes SQLite
      await initDatabase();

      // 2. Start network monitoring
      networkOrchestrator.start();
      networkOrchestrator.onConnectivityRestored(() => {
        flushQueue();
      });

      // 3. Load user profile → determines routing on SplashScreen
      await loadFromDatabase();

      // 4. Auto-resume session if last activity was within the timeout window
      const lastActivity = await getLastActivityAt();
      if (lastActivity && Date.now() - lastActivity < SESSION_TIMEOUT_MS) {
        sessionStore.getState().signIn();
      }

      // 5. SLM init — proceeds past splash either way (cloud covers no-model case)
      slmAdapter.initialize().finally(() => setIsModelReady(true));

      // 6. Pre-warm local RAG and check for KB updates in the background
      localRAG.initialize().catch(() => undefined);
      checkAndUpdateKnowledgeBase().catch(() => undefined);

      // 7. Start transmission retry loop
      startRetryLoop();
    }

    bootstrap();

    // ── AppState listener ──────────────────────────────────────────────────────
    // When the app comes back to the foreground, check if the session has expired.
    // Also persist lastActivityAt to SQLite when the app goes to the background so
    // the auto-resume check on next launch works correctly.
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'background' || nextState === 'inactive') {
        // Persist last activity before going to background
        const { isSignedIn, lastActivityAt } = sessionStore.getState();
        if (isSignedIn && lastActivityAt > 0) {
          setLastActivityAt(lastActivityAt).catch(() => undefined);
        }
        return;
      }

      if (nextState === 'active' && prevState !== 'active') {
        // Returning to foreground — check for session expiry
        if (sessionStore.getState().isExpired()) {
          sessionStore.getState().signOut();
          navigateToLogin();
        }
      }
    });

    // ── Periodic idle check (every 60 s while app is foregrounded) ─────────────
    const idleTimer = setInterval(() => {
      if (sessionStore.getState().isExpired()) {
        sessionStore.getState().signOut();
        navigateToLogin();
      }
    }, 60_000);

    return () => {
      subscription.remove();
      clearInterval(idleTimer);
    };
  }, [loadFromDatabase]);

  return (
    <NavigationContainer ref={navigationRef}>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{ headerStyle: { backgroundColor: '#0a0a0a' }, headerTintColor: '#ffffff' }}
      >
        <Stack.Screen name="Splash" options={{ headerShown: false }}>
          {(props) => <SplashScreen {...props} isModelReady={isModelReady} />}
        </Stack.Screen>

        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />

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

        <Stack.Screen
          name="AppointmentBooking"
          component={AppointmentBookingScreen}
          options={{ title: 'Book Appointment', headerBackVisible: true }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
