import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useUserStore } from '../store/userStore';
import { useSessionStore } from '../store/sessionStore';
import { deleteUserProfile, clearActiveSession } from '../db/queries';
import type { RootStackParamList } from '../../App';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
}

const CNIC_REGEX = /^\d{5}-\d{7}-\d{1}$/;

export default function LoginScreen({ navigation }: Props) {
  const profile = useUserStore((s) => s.profile);
  const clearProfile = useUserStore((s) => s.clearProfile);
  const signIn = useSessionStore((s) => s.signIn);

  const [cnic, setCnic] = useState('');
  const [cnicError, setCnicError] = useState('');
  const [loading, setLoading] = useState(false);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'User';

  function validateCnic(value: string) {
    setCnic(value);
    setCnicError(
      CNIC_REGEX.test(value) || value === '' ? '' : 'Format: 42201-1234567-8',
    );
  }

  async function handleSignIn() {
    if (!CNIC_REGEX.test(cnic) || loading) return;
    setLoading(true);
    try {
      if (cnic.trim() !== profile?.cnic) {
        setCnicError('CNIC does not match the registered profile');
        return;
      }
      signIn();
      navigation.replace('Home');
    } finally {
      setLoading(false);
    }
  }

  function handleDifferentUser() {
    Alert.alert(
      'Switch Patient',
      'This removes the current profile from this device. All pending assessments will be lost. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove & Register New',
          style: 'destructive',
          onPress: async () => {
            await deleteUserProfile();
            await clearActiveSession();
            clearProfile();
            navigation.replace('Registration');
          },
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      {/* Logo */}
      <View style={styles.logoCircle}>
        <Text style={styles.logoLetter}>M</Text>
      </View>

      <Text style={styles.welcomeLabel}>Welcome back</Text>
      <Text style={styles.name}>{firstName}</Text>
      <Text style={styles.subtitle}>Enter your CNIC to continue</Text>

      {/* Form */}
      <View style={styles.form}>
        <Text style={styles.label}>CNIC</Text>
        <TextInput
          style={[styles.input, cnicError ? styles.inputError : null]}
          value={cnic}
          onChangeText={validateCnic}
          placeholder="42201-1234567-8"
          placeholderTextColor="#6b7280"
          keyboardType="numeric"
          returnKeyType="done"
          onSubmitEditing={handleSignIn}
          autoFocus
        />
        {cnicError ? <Text style={styles.errorText}>{cnicError}</Text> : null}

        <TouchableOpacity
          style={[
            styles.signInBtn,
            (!CNIC_REGEX.test(cnic) || loading) && styles.signInBtnDisabled,
          ]}
          onPress={handleSignIn}
          disabled={!CNIC_REGEX.test(cnic) || loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.signInText}>SIGN IN</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switchBtn}
          onPress={handleDifferentUser}
          activeOpacity={0.7}
        >
          <Text style={styles.switchText}>Different patient? Register new profile</Text>
        </TouchableOpacity>
      </View>

      {/* Session info */}
      <View style={styles.sessionNote}>
        <Text style={styles.sessionNoteText}>
          Sessions expire after 17 minutes of inactivity
        </Text>
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
    paddingHorizontal: 28,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  logoLetter: { color: '#ffffff', fontSize: 36, fontWeight: '700' },
  welcomeLabel: { color: '#9ca3af', fontSize: 15 },
  name: { color: '#ffffff', fontSize: 26, fontWeight: '700', marginTop: 4, marginBottom: 8 },
  subtitle: { color: '#6b7280', fontSize: 14, marginBottom: 40 },
  form: { width: '100%', gap: 10 },
  label: { color: '#d1d5db', fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#ffffff',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  inputError: { borderColor: '#dc2626' },
  errorText: { color: '#f87171', fontSize: 12 },
  signInBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  signInBtnDisabled: { backgroundColor: '#4b1212', opacity: 0.6 },
  signInText: { color: '#ffffff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  switchBtn: { alignItems: 'center', paddingVertical: 14 },
  switchText: { color: '#60a5fa', fontSize: 14 },
  sessionNote: {
    position: 'absolute',
    bottom: 40,
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  sessionNoteText: { color: '#4b5563', fontSize: 11, letterSpacing: 0.3 },
});
