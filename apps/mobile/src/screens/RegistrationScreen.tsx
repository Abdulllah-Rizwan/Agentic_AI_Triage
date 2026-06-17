import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Location from 'expo-location';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { saveUserProfile, hashPassword } from '../db/queries';
import { useUserStore } from '../store/userStore';
import { useThemeStore } from '../store/themeStore';
import { darkColors, lightColors, type ThemeColors } from '../theme/colors';
import type { RootStackParamList } from '../../App';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Registration'>;
}

const PHONE_REGEX = /^\+92-\d{3}-\d{7}$/;
const CNIC_REGEX = /^\d{5}-\d{7}-\d{1}$/;
const PW_MIN = 6;

export default function RegistrationScreen({ navigation }: Props) {
  const setProfile = useUserStore((s) => s.setProfile);
  const isDark = useThemeStore((s) => s.isDark);
  const toggle = useThemeStore((s) => s.toggle);
  const colors = isDark ? darkColors : lightColors;
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [cnic, setCnic] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<'detecting' | 'found' | 'denied'>('detecting');
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  const [phoneError, setPhoneError] = useState('');
  const [cnicError, setCnicError] = useState('');
  const [pwError, setPwError] = useState('');
  const [confirmPwError, setConfirmPwError] = useState('');

  useEffect(() => {
    requestLocation();
  }, []);

  async function requestLocation() {
    setLocationStatus('detecting');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocationStatus('denied'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLat(pos.coords.latitude);
      setLng(pos.coords.longitude);
      setLocationStatus('found');
    } catch {
      setLocationStatus('denied');
    }
  }

  function validatePhone(value: string) {
    setPhone(value);
    setPhoneError(PHONE_REGEX.test(value) || value === '' ? '' : 'Enter a valid Pakistan number: +92-300-1234567');
  }

  function validateCnic(value: string) {
    setCnic(value);
    setCnicError(CNIC_REGEX.test(value) || value === '' ? '' : 'Enter a valid CNIC: 42201-1234567-8');
  }

  function validatePassword(value: string) {
    setPassword(value);
    setPwError(value.length >= PW_MIN || value === '' ? '' : `Password must be at least ${PW_MIN} characters`);
    if (confirmPassword && value !== confirmPassword) {
      setConfirmPwError('Passwords do not match');
    } else {
      setConfirmPwError('');
    }
  }

  function validateConfirmPassword(value: string) {
    setConfirmPassword(value);
    setConfirmPwError(value === password || value === '' ? '' : 'Passwords do not match');
  }

  const isFormValid =
    fullName.trim().length >= 2 &&
    PHONE_REGEX.test(phone) &&
    CNIC_REGEX.test(cnic) &&
    password.length >= PW_MIN &&
    password === confirmPassword &&
    disclaimerChecked &&
    lat !== null &&
    lng !== null;

  async function handleSubmit() {
    if (!isFormValid || saving) return;
    setSaving(true);
    try {
      const password_hash = await hashPassword(password);
      const profile = {
        full_name: fullName.trim(),
        phone,
        cnic,
        lat,
        lng,
        registered_at: Date.now(),
        password_hash,
      };
      await saveUserProfile(profile);
      setProfile({ ...profile, id: 'local_user' });
      navigation.replace('Home');
    } catch (err) {
      Alert.alert('Error', 'Failed to save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function renderLocationField() {
    let label = '📍 Detecting location...';
    if (locationStatus === 'found' && lat !== null && lng !== null) {
      label = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } else if (locationStatus === 'denied') {
      label = '📍 Location unavailable';
    }
    return (
      <View style={styles.locationContainer}>
        <View style={styles.locationField}>
          <Text style={styles.locationText}>{label}</Text>
        </View>
        <TouchableOpacity style={styles.updateLocationBtn} onPress={requestLocation}>
          <Text style={styles.updateLocationText}>Update Location</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {/* Theme toggle */}
      <TouchableOpacity style={styles.themeToggle} onPress={toggle} activeOpacity={0.7}>
        <Text style={styles.themeToggleText}>{isDark ? '☀' : '🌙'}</Text>
      </TouchableOpacity>

      <Text style={styles.header}>Create Your Profile</Text>
      <Text style={styles.subtext}>Your information helps responders find you</Text>

      <View style={styles.form}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Ahmed Khan"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={[styles.input, phoneError ? styles.inputError : null]}
            value={phone}
            onChangeText={validatePhone}
            placeholder="+92-300-1234567"
            placeholderTextColor={colors.placeholderText}
            keyboardType="phone-pad"
          />
          {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>CNIC</Text>
          <TextInput
            style={[styles.input, cnicError ? styles.inputError : null]}
            value={cnic}
            onChangeText={validateCnic}
            placeholder="42201-1234567-8"
            placeholderTextColor={colors.placeholderText}
            keyboardType="numeric"
          />
          {cnicError ? <Text style={styles.errorText}>{cnicError}</Text> : null}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Password</Text>
          <View style={[styles.passwordRow, pwError ? styles.inputError : null]}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={validatePassword}
              placeholder={`Minimum ${PW_MIN} characters`}
              placeholderTextColor={colors.placeholderText}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
              <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>
          {pwError ? <Text style={styles.errorText}>{pwError}</Text> : null}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Confirm Password</Text>
          <TextInput
            style={[styles.input, confirmPwError ? styles.inputError : null]}
            value={confirmPassword}
            onChangeText={validateConfirmPassword}
            placeholder="Repeat your password"
            placeholderTextColor={colors.placeholderText}
            secureTextEntry={!showPassword}
          />
          {confirmPwError ? <Text style={styles.errorText}>{confirmPwError}</Text> : null}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Location</Text>
          {renderLocationField()}
          {locationStatus === 'denied' && (
            <Text style={styles.errorText}>
              Location is required. Tap "Update Location" to enable GPS, or check your phone settings.
            </Text>
          )}
        </View>

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerTitle}>⚠️ Medical Disclaimer</Text>
          <Text style={styles.disclaimerBody}>
            This application provides AI-assisted symptom collection only. It is NOT a substitute for
            professional medical diagnosis or treatment. In a life-threatening emergency, contact
            emergency services immediately.
          </Text>
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setDisclaimerChecked((v) => !v)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, disclaimerChecked && styles.checkboxChecked]}>
              {disclaimerChecked && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkboxLabel}>
              I understand this is not a medical diagnosis tool
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, (!isFormValid || saving) && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!isFormValid || saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.submitText}>CREATE PROFILE</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bgPrimary },
    container: { flexGrow: 1, alignItems: 'center', padding: 24, paddingBottom: 40 },
    themeToggle: { position: 'absolute', top: 16, right: 16, padding: 8, zIndex: 10 },
    themeToggleText: { fontSize: 22 },
    header: { color: colors.textPrimary, fontSize: 24, fontWeight: '700', marginTop: 48, textAlign: 'center' },
    subtext: { color: colors.textMuted, fontSize: 14, marginTop: 8, textAlign: 'center' },
    form: { width: '100%', marginTop: 32, gap: 20 },
    fieldGroup: { gap: 6 },
    label: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
    input: {
      backgroundColor: colors.bgInput,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      color: colors.textPrimary,
      fontSize: 15,
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
      paddingVertical: 12,
      color: colors.textPrimary,
      fontSize: 15,
    },
    eyeBtn: { paddingHorizontal: 14 },
    eyeText: { fontSize: 18 },
    inputError: { borderColor: '#dc2626' },
    errorText: { color: '#f87171', fontSize: 12, marginTop: 2 },
    locationContainer: { gap: 8 },
    locationField: {
      backgroundColor: colors.bgInput,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    locationText: { color: colors.textMuted, fontSize: 15 },
    updateLocationBtn: {
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.bgTertiary,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    updateLocationText: { color: '#60a5fa', fontSize: 13, fontWeight: '600' },
    disclaimer: {
      borderWidth: 1,
      borderColor: '#dc2626',
      backgroundColor: '#1a0505',
      borderRadius: 12,
      padding: 16,
      gap: 10,
    },
    disclaimerTitle: { color: '#f87171', fontSize: 15, fontWeight: '700' },
    disclaimerBody: { color: '#fca5a5', fontSize: 13, lineHeight: 20 },
    checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    checkbox: {
      width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: '#dc2626',
      alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
    },
    checkboxChecked: { backgroundColor: '#dc2626' },
    checkmark: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
    checkboxLabel: { color: '#fca5a5', fontSize: 13, flex: 1, lineHeight: 20 },
    submitBtn: {
      backgroundColor: '#dc2626', borderRadius: 12, paddingVertical: 16,
      alignItems: 'center', marginTop: 8,
    },
    submitBtnDisabled: { backgroundColor: '#4b1212', opacity: 0.6 },
    submitText: { color: '#ffffff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
  });
}
