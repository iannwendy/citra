/**
 * i18n Configuration
 * Setup for internationalization with react-i18next
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import vi from './locales/vi.json';

// ============================================================
// i18next Configuration
// ============================================================

const resources = {
  en: { translation: en },
  vi: { translation: vi },
};

export function resolveInitialLanguage(
  saved?: string | null,
  browserLang?: string | null,
): 'en' | 'vi' {
  const savedClean = (saved ?? '').trim().toLowerCase();
  if (savedClean.startsWith('vi')) return 'vi';
  if (savedClean.startsWith('en')) return 'en';
  const navClean = (browserLang ?? '').trim().toLowerCase();
  return navClean.startsWith('vi') ? 'vi' : 'en';
}

const savedLanguage =
  typeof window !== 'undefined'
    ? localStorage.getItem('language') || localStorage.getItem('i18nextLng')
    : null;

const browserLanguage =
  typeof navigator !== 'undefined' ? navigator.language : null;

const initialLanguage = resolveInitialLanguage(savedLanguage, browserLanguage);

i18n
  // Detect user language
  .use(LanguageDetector)
  // Pass to react-i18next
  .use(initReactI18next)
  .init({
    resources,
    // Fallback language
    fallbackLng: 'en',
    // Default language: saved localStorage preference if present, else browser language (vi* -> vi, else en)
    lng: initialLanguage,
    supportedLngs: ['en', 'vi'],
    // Interpolation
    interpolation: {
      escapeValue: false, // React already escapes
    },
    // Detection options
    detection: {
      // Language storage key
      order: ['localStorage', 'navigator'],
      // Lookup from localStorage
      lookupLocalStorage: 'language',
      // Cache user language choice
      caches: ['localStorage'],
    },
  });

// Immediately sync <html lang="..."> on boot so F5 reload on EN never reverts to static lang="vi"
if (typeof document !== 'undefined') {
  document.documentElement.lang = (i18n.language || initialLanguage || 'en').split('-')[0];
}

// Persist language choice to both storage keys and update <html lang="...">
i18n.on('languageChanged', (lng) => {
  if (typeof window !== 'undefined') {
    const cleanLng = lng.split('-')[0];
    localStorage.setItem('language', cleanLng);
    localStorage.setItem('i18nextLng', cleanLng);
    document.documentElement.lang = cleanLng;
  }
});

export default i18n;
