import React, { useMemo, useState } from 'react';
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
import { useThemeStore } from '../store/themeStore';
import { darkColors, lightColors, type ThemeColors } from '../theme/colors';
import { deleteUserProfile, clearActiveSession, hashPassword } from '../db/queries';
import type { RootStackParamList } from '../../App';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
}

const CNIC_REGEX = /^\d{5}-\d{7}-\d{1}$/;
const PW_MIN = 6;

export default function LoginScreen({ navigation }: Props) {
  const profile = useUserStore((s) => s.profile);
  const clearProfile = useUserStore((s) => s.clearProfile);
  const signIn = useSessionStore((s) => s.signIn);
  const isDark = useThemeStore((s) => s.isDark);
  const toggle = useThemeStore((s) => s.toggle);
  const colors = isDark ? darkColors : lightColors;
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [cnic, setCnic] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [cnicError, setCnicError] = useState('');
  const [pwError, setPwError] = useState('');
  const [loading, setLoading] = useState(false);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'User';

  function validateCnic(value: string) {
    setCnic(value);
    setCnicError(
      CNIC_REGEX.test(value) || value === '' ? '' : 'Format: 42201-1234567-8',
    );
  }

  const isFormValid = CNIC_REGEX.test(cnic) && password.length >= PW_MIN;

  async function handleSignIn() {
    if (!isFormValid || loading) return;
    setLoading(true);
    setPwError('');
    setCnicError('');
    try {
      if (cnic.trim() !== profile?.cnic) {
        setCnicError('CNIC does not match the registered profile');
        return;
      }
      if (profile?.password_hash) {
        const inputHash = await hashPassword(password);
        if (inputHash !== profile.password_hash) {
          setPwError('Incorrect password');
          return;
        }
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
      {/* Theme toggle */}
      <TouchableOpacity style={styles.themeToggle} onPress={toggle} activeOpacity={0.7}>
        <Text style={styles.themeToggleText}>{isDark ? '☀' : '🌙'}</Text>
      </TouchableOpacity>

      {/* Logo */}
      <View style={styles.logoCircle}>
        <Text style={styles.logoLetter}>M</Text>
      </View>

      <Text style={styles.welcomeLabel}>Welcome back</Text>
      <Text style={styles.name}>{firstName}</Text>
      <Text style={styles.subtitle}>Enter your CNIC and password to continue</Text>

      {/* Form */}
      <View style={styles.form}>
        <Text style={styles.label}>CNIC</Text>
        <TextInput
          style={[styles.input, cnicError ? styles.inputError : null]}
          value={cnic}
          onChangeText={validateCnic}
          placeholder="42201-1234567-8"
          placeholderTextColor={colors.placeholderText}
          keyboardType="numeric"
          returnKeyType="next"
          autoFocus
        />
        {cnicError ? <Text style={styles.errorText}>{cnicError}</Text> : null}

        <Text style={[styles.label, { marginTop: 12 }]}>Password</Text>
        <View style={[styles.passwordRow, pwError ? styles.inputError : null]}>
          <TextInput
            style={styles.passwordInput}
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor={colors.placeholderText}
            secureTextEntry={!showPassword}
            returnKeyType="done"
            onSubmitEditing={handleSignIn}
          />
          <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
            <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        </View>
        {pwError ? <Text style={styles.errorText}>{pwError}</Text> : null}

        <TouchableOpacity
          style={[styles.signInBtn, (!isFormValid || loading) && styles.signInBtnDisabled]}
          onPress={handleSignIn}
          disabled={!isFormValid || loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.signInText}>SIGN IN</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.switchBtn} onPress={handleDifferentUser} activeOpacity={0.7}>
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

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bgPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 28,
    },
    themeToggle: {
      position: 'absolute',
      top: 52,
      right: 24,
      padding: 8,
    },
    themeToggleText: { fontSize: 22 },
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
    welcomeLabel: { color: colors.textMuted, fontSize: 15 },
    name: { color: colors.textPrimary, fontSize: 26, fontWeight: '700', marginTop: 4, marginBottom: 8 },
    subtitle: { color: colors.textSubtle, fontSize: 14, marginBottom: 40, textAlign: 'center' },
    form: { width: '100%', gap: 6 },
    label: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
    input: {
      backgroundColor: colors.bgInput,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 14,
      color: colors.textPrimary,
      fontSize: 16,
      letterSpacing: 0.5,
    },
    passwordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgInput,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
    },
    passwordInput: {
      flex: 1,
      paddingHorizontal: 16,
      paddingVertical: 14,
      color: colors.textPrimary,
      fontSize: 16,
    },
    eyeBtn: { paddingHorizontal: 14 },
    eyeText: { fontSize: 18 },
    inputError: { borderColor: '#dc2626' },
    errorText: { color: '#f87171', fontSize: 12, marginTop: 2 },
    signInBtn: {
      backgroundColor: '#dc2626',
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 16,
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
      backgroundColor: colors.bgCard,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sessionNoteText: { color: colors.textFaint, fontSize: 11, letterSpacing: 0.3 },
  });
}
