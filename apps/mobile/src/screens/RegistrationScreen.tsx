import React, { useState, useEffect } from 'react';
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
import { saveUserProfile } from '../db/queries';
import { useUserStore } from '../store/userStore';
import type { RootStackParamList } from '../../App';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Registration'>;
}

const PHONE_REGEX = /^\+92-\d{3}-\d{7}$/;
const CNIC_REGEX = /^\d{5}-\d{7}-\d{1}$/;

export default function RegistrationScreen({ navigation }: Props) {
  const setProfile = useUserStore((s) => s.setProfile);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [cnic, setCnic] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<'detecting' | 'found' | 'denied'>('detecting');
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  const [phoneError, setPhoneError] = useState('');
  const [cnicError, setCnicError] = useState('');

  useEffect(() => {
    requestLocation();
  }, []);

  async function requestLocation() {
    setLocationStatus('detecting');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationStatus('denied');
        return;
      }
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

  const isFormValid =
    fullName.trim().length >= 2 &&
    PHONE_REGEX.test(phone) &&
    CNIC_REGEX.test(cnic) &&
    disclaimerChecked;

  async function handleSubmit() {
    if (!isFormValid || saving) return;
    setSaving(true);
    try {
      const profile = {
        full_name: fullName.trim(),
        phone,
        cnic,
        lat,
        lng,
        registered_at: Date.now(),
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
            placeholderTextColor="#6b7280"
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
            placeholderTextColor="#6b7280"
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
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />
          {cnicError ? <Text style={styles.errorText}>{cnicError}</Text> : null}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Location</Text>
          {renderLocationField()}
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
            <Text style={styles.submitText}>BEGIN ASSESSMENT</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flexGrow: 1, alignItems: 'center', padding: 24, paddingBottom: 40 },
  header: { color: '#ffffff', fontSize: 24, fontWeight: '700', marginTop: 48, textAlign: 'center' },
  subtext: { color: '#9ca3af', fontSize: 14, marginTop: 8, textAlign: 'center' },
  form: { width: '100%', marginTop: 32, gap: 20 },
  fieldGroup: { gap: 6 },
  label: { color: '#d1d5db', fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 15,
  },
  inputError: { borderColor: '#dc2626' },
  errorText: { color: '#f87171', fontSize: 12, marginTop: 2 },
  locationContainer: { gap: 8 },
  locationField: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  locationText: { color: '#9ca3af', fontSize: 15 },
  updateLocationBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1f2937',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
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
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: '#dc2626' },
  checkmark: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  checkboxLabel: { color: '#fca5a5', fontSize: 13, flex: 1, lineHeight: 20 },
  submitBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: { backgroundColor: '#4b1212', opacity: 0.6 },
  submitText: { color: '#ffffff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
});
