import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ko from './locales/ko.json';
import en from './locales/en.json';
import ja from './locales/ja.json';

// Get saved language from localStorage or default to Korean
const getSavedLanguage = () => {
  try {
    const settings = localStorage.getItem('app_settings');
    if (settings) {
      const parsed = JSON.parse(settings);
      return parsed.language || 'ko';
    }
  } catch (e) {
    console.error('Failed to load language setting:', e);
  }
  return 'ko';
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      en: { translation: en },
      ja: { translation: ja }
    },
    lng: getSavedLanguage(),
    fallbackLng: 'ko',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
