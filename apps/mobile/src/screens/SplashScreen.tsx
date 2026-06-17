import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Image,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNetworkStore } from '../store/networkStore';
import { useUserStore } from '../store/userStore';
import { useSessionStore } from '../store/sessionStore';
import { useThemeStore } from '../store/themeStore';
import { darkColors, lightColors } from '../theme/colors';
import { slmAdapter } from '../services/llm/SLMAdapter';
import type { RootStackParamList } from '../../App';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Splash'>;
  isModelReady: boolean;
}

export default function SplashScreen({ navigation, isModelReady }: Props) {
  const networkMode = useNetworkStore((s) => s.mode);
  const isRegistered = useUserStore((s) => s.isRegistered);
  const isSignedIn = useSessionStore((s) => s.isSignedIn);
  const isDark = useThemeStore((s) => s.isDark);
  const colors = isDark ? darkColors : lightColors;

  const [timedOut, setTimedOut] = useState(false);
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 30_000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isModelReady || timedOut) {
      if (!isRegistered) {
        navigation.replace('Registration');
      } else if (isSignedIn) {
        navigation.replace('Home');
      } else {
        navigation.replace('Login');
      }
    }
  }, [isModelReady, timedOut, isRegistered, isSignedIn, navigation]);

  function renderSLMStatus() {
    if (!isModelReady) {
      return (
        <View style={styles.statusRow}>
          <Animated.View style={[styles.dot, styles.dotAmber, { opacity: pulseAnim }]} />
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>Loading Device AI...</Text>
        </View>
      );
    }
    if (slmAdapter.isModelReady()) {
      return (
        <View style={styles.statusRow}>
          <View style={[styles.dot, styles.dotGreen]} />
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>Device AI Ready</Text>
        </View>
      );
    }
    return (
      <View style={styles.statusRow}>
        <View style={[styles.dot, styles.dotAmber]} />
        <Text style={[styles.statusText, { color: colors.textSecondary }]}>Cloud AI Mode</Text>
      </View>
    );
  }

  function renderNetworkBadge() {
    const configs = {
      FULL: { label: 'CLOUD AI ACTIVE', bg: '#166534', text: '#4ade80' },
      DEGRADED: { label: 'DEVICE AI ACTIVE', bg: '#78350f', text: '#fbbf24' },
      OFFLINE: { label: 'OFFLINE MODE', bg: '#7f1d1d', text: '#f87171' },
    };
    const cfg = configs[networkMode];
    return (
      <View style={[styles.networkBadge, { backgroundColor: cfg.bg }]}>
        <Text style={[styles.networkBadgeText, { color: cfg.text }]}>{cfg.label}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <Image
        source={require('../assets/logo.jpg')}
        style={styles.logoImage}
        resizeMode="contain"
      />
      <Text style={[styles.appName, { color: colors.textPrimary }]}>MediReach</Text>
      <Text style={[styles.appSubtitle, { color: colors.textMuted }]}>Emergency Medical Assessment</Text>

      <View style={styles.statusSection}>
        {renderSLMStatus()}
        {renderNetworkBadge()}
      </View>

      <View style={[styles.offlineBadge, { backgroundColor: colors.bgTertiary, borderColor: colors.border }]}>
        <Text style={[styles.offlineBadgeText, { color: colors.textMuted }]}>OFFLINE READY</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoImage: {
    width: 120,
    height: 120,
  },
  appName: { fontSize: 32, fontWeight: '700', marginTop: 16 },
  appSubtitle: { fontSize: 16, marginTop: 8 },
  statusSection: { marginTop: 48, alignItems: 'center', gap: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotGreen: { backgroundColor: '#22c55e' },
  dotAmber: { backgroundColor: '#f59e0b' },
  statusText: { fontSize: 14 },
  networkBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  networkBadgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  offlineBadge: {
    position: 'absolute',
    bottom: 48,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  offlineBadgeText: { fontSize: 12, fontWeight: '600', letterSpacing: 1 },
});
