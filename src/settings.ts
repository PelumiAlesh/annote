import { normalizeThemePreference, type ThemePreference } from "./theme";

export type AnnoteSettings = {
  theme: ThemePreference;
  pauseAnimationOnSelect: boolean;
  clearAfterSend: boolean;
  preventPageActions: boolean;
  reactContext: boolean;
  continuousDictation: boolean;
};

export type FeedbackMarkSettings = AnnoteSettings;

export const SETTINGS_STORAGE_KEY = "annote:settings:v1";
export const LEGACY_SETTINGS_STORAGE_KEY = "feedback-mark:settings:v1";

export const DEFAULT_SETTINGS: AnnoteSettings = {
  theme: "opposite-page",
  pauseAnimationOnSelect: true,
  clearAfterSend: false,
  preventPageActions: true,
  reactContext: true,
  continuousDictation: false,
};

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function normalizeSettings(value: unknown): AnnoteSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_SETTINGS };
  const raw = value as Partial<Record<keyof AnnoteSettings, unknown>>;
  return {
    theme: normalizeThemePreference(raw.theme),
    pauseAnimationOnSelect: isBoolean(raw.pauseAnimationOnSelect)
      ? raw.pauseAnimationOnSelect
      : DEFAULT_SETTINGS.pauseAnimationOnSelect,
    clearAfterSend: isBoolean(raw.clearAfterSend) ? raw.clearAfterSend : DEFAULT_SETTINGS.clearAfterSend,
    preventPageActions: isBoolean(raw.preventPageActions)
      ? raw.preventPageActions
      : DEFAULT_SETTINGS.preventPageActions,
    reactContext: isBoolean(raw.reactContext) ? raw.reactContext : DEFAULT_SETTINGS.reactContext,
    continuousDictation: isBoolean(raw.continuousDictation)
      ? raw.continuousDictation
      : DEFAULT_SETTINGS.continuousDictation,
  };
}

export function loadSettings(storage: SettingsStorage = localStorage): AnnoteSettings {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
    const legacy = storage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (!legacy) return { ...DEFAULT_SETTINGS };
    const migrated = normalizeSettings(JSON.parse(legacy));
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AnnoteSettings, storage: SettingsStorage = localStorage): boolean {
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

export function updateSetting<K extends keyof AnnoteSettings>(
  settings: AnnoteSettings,
  key: K,
  value: AnnoteSettings[K],
): AnnoteSettings {
  return normalizeSettings({ ...settings, [key]: value });
}
