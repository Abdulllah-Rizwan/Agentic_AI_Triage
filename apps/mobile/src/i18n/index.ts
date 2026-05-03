import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { NativeModules, Platform } from 'react-native';

import en from './en.json';
import ur from './ur.json';

const deviceLocale =
  Platform.OS === 'ios'
    ? NativeModules.SettingsManager?.settings?.AppleLocale ??
      NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
    : NativeModules.I18nManager?.localeIdentifier;

const languageCode = typeof deviceLocale === 'string'
  ? deviceLocale.split('_')[0]
  : 'en';

i18n.use(initReactI18next).init({
  compatibilityJSON: 'v3',
  resources: { en: { translation: en }, ur: { translation: ur } },
  lng: languageCode === 'ur' ? 'ur' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
