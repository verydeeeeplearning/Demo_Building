import { en } from './locales/en.js';
import { ko } from './locales/ko.js';

export const LOCALE_STORAGE_KEY = 'hEduwareLocale';
export const SUPPORTED_LOCALES = ['ko', 'en'];

const DICTIONARIES = { ko, en };
let currentLocale = readStoredLocale();

export function normalizeLocale(locale) {
  const normalized = String(locale || '').toLowerCase();
  return SUPPORTED_LOCALES.includes(normalized) ? normalized : 'ko';
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  currentLocale = normalizeLocale(locale);
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, currentLocale);
  } catch (error) {
    // Storage can fail in restricted browser modes; the in-memory locale is enough.
  }
  return currentLocale;
}

export function t(key, values = {}, locale = currentLocale) {
  const selected = lookup(DICTIONARIES[normalizeLocale(locale)], key);
  const fallback = lookup(en, key);
  const value = selected ?? fallback;
  if (value === undefined) {
    return key;
  }
  if (typeof value !== 'string') {
    return value;
  }
  return interpolate(value, values);
}

function readStoredLocale() {
  try {
    return normalizeLocale(globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY));
  } catch (error) {
    return 'ko';
  }
}

function lookup(dictionary, key) {
  return key.split('.').reduce((value, part) => value?.[part], dictionary);
}

function interpolate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    return values[name] ?? `{${name}}`;
  });
}
