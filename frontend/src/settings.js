const FONT_SIZE_KEY = "marka-font-size";
const LANGUAGE_KEY = "marka-lang";
const LINE_NUMBERS_KEY = "marka-line-numbers";
const LINE_WRAPPING_KEY = "marka-line-wrapping";

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 28;
const FALLBACK_LANGUAGE = "en";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function detectDefaultLanguage() {
  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    return navigator.language.startsWith("ja") ? "ja" : "en";
  }
  return FALLBACK_LANGUAGE;
}

export function getDefaultSettings() {
  return {
    fontSize: 16,
    uiLanguage: detectDefaultLanguage(),
    showLineNumbers: true,
    lineWrapping: true,
  };
}

function normalizeLanguage(value, fallback = detectDefaultLanguage()) {
  return value === "ja" || value === "en" ? value : fallback;
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeFontSize(value, fallback = getDefaultSettings().fontSize) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(Math.round(parsed), MIN_FONT_SIZE, MAX_FONT_SIZE);
}

export function normalizeSettings(settings = {}) {
  const defaults = getDefaultSettings();
  return {
    fontSize: normalizeFontSize(settings.fontSize, defaults.fontSize),
    uiLanguage: normalizeLanguage(settings.uiLanguage, defaults.uiLanguage),
    showLineNumbers: normalizeBoolean(settings.showLineNumbers, defaults.showLineNumbers),
    lineWrapping: normalizeBoolean(settings.lineWrapping, defaults.lineWrapping),
  };
}

function getStorage() {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function readBoolean(storage, key, fallback) {
  const raw = storage.getItem(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export function loadSettings() {
  const defaults = getDefaultSettings();
  const storage = getStorage();
  if (!storage) return defaults;

  return normalizeSettings({
    fontSize: storage.getItem(FONT_SIZE_KEY),
    uiLanguage: storage.getItem(LANGUAGE_KEY) ?? defaults.uiLanguage,
    showLineNumbers: readBoolean(storage, LINE_NUMBERS_KEY, defaults.showLineNumbers),
    lineWrapping: readBoolean(storage, LINE_WRAPPING_KEY, defaults.lineWrapping),
  });
}

export function saveSettings(partialSettings = {}) {
  const nextSettings = normalizeSettings({
    ...loadSettings(),
    ...partialSettings,
  });
  const storage = getStorage();
  if (!storage) return nextSettings;

  storage.setItem(FONT_SIZE_KEY, String(nextSettings.fontSize));
  storage.setItem(LANGUAGE_KEY, nextSettings.uiLanguage);
  storage.setItem(LINE_NUMBERS_KEY, String(nextSettings.showLineNumbers));
  storage.setItem(LINE_WRAPPING_KEY, String(nextSettings.lineWrapping));

  return nextSettings;
}

export const FONT_SIZE_RANGE = Object.freeze({
  min: MIN_FONT_SIZE,
  max: MAX_FONT_SIZE,
});
