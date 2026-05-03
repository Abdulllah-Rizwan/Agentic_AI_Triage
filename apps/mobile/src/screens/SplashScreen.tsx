import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNetworkStore } from '../store/networkStore';
import { useUserStore } from '../store/userStore';
import type { RootStackParamList } from '../../App';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Splash'>;
  isModelReady: boolean;
}

export default function SplashScreen({ navigation, isModelReady }: Props) {
  const networkMode = useNetworkStore((s) => s.mode);
  const isRegistered = useUserStore((s) => s.isRegistered);
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
      const dest = isRegistered ? 'Home' : 'Registration';
      navigation.replace(dest);
    }
  }, [isModelReady, timedOut, isRegistered, navigation]);

  function renderSLMStatus() {
    if (timedOut && !isModelReady) {
      return (
        <View style={styles.statusRow}>
          <View style={[styles.dot, styles.dotRed]} />
          <Text style={styles.statusText}>Device AI Unavailable — Cloud Only</Text>
        </View>
      );
    }
    if (isModelReady) {
      return (
        <View style={styles.statusRow}>
          <View style={[styles.dot, styles.dotGreen]} />
          <Text style={styles.statusText}>Device AI Ready</Text>
        </View>
      );
    }
    return (
      <View style={styles.statusRow}>
        <Animated.View style={[styles.dot, styles.dotAmber, { opacity: pulseAnim }]} />
        <Text style={styles.statusText}>Loading Device AI...</Text>
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
    <View style={styles.container}>
      <View style={styles.logoCircle}>
        <Text style={styles.logoLetter}>M</Text>
      </View>
      <Text style={styles.appName}>MediReach</Text>
      <Text style={styles.appSubtitle}>Emergency Medical Assessment</Text>

      <View style={styles.statusSection}>
        {renderSLMStatus()}
        {renderNetworkBadge()}
      </View>

      <View style={styles.offlineBadge}>
        <Text style={styles.offlineBadgeText}>OFFLINE READY</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: '700',
  },
  appName: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '700',
    marginTop: 16,
  },
  appSubtitle: {
    color: '#9ca3af',
    fontSize: 16,
    marginTop: 8,
  },
  statusSection: {
    marginTop: 48,
    alignItems: 'center',
    gap: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGreen: { backgroundColor: '#22c55e' },
  dotAmber: { backgroundColor: '#f59e0b' },
  dotRed: { backgroundColor: '#ef4444' },
  statusText: {
    color: '#d1d5db',
    fontSize: 14,
  },
  networkBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 4,
  },
  networkBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  offlineBadge: {
    position: 'absolute',
    bottom: 48,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#1f2937',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#374151',
  },
  offlineBadgeText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
});
