import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SETTINGS,
  LEGACY_SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  normalizeSettings,
  saveSettings,
  updateSetting,
} from "/tmp/feedback-mark-settings.mjs";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
}

test("loads default settings when storage is empty", () => {
  assert.deepEqual(loadSettings(memoryStorage()), DEFAULT_SETTINGS);
});

test("continuous dictation defaults off and survives migration", () => {
  assert.equal(DEFAULT_SETTINGS.continuousDictation, false);
  const storage = memoryStorage({
    [LEGACY_SETTINGS_STORAGE_KEY]: JSON.stringify({ clearAfterSend: true }),
  });
  assert.equal(loadSettings(storage).continuousDictation, false);
  const on = memoryStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({ continuousDictation: true }),
  });
  assert.equal(loadSettings(on).continuousDictation, true);
});

test("migrates legacy Feedback Mark settings to Annote settings", () => {
  const storage = memoryStorage({
    [LEGACY_SETTINGS_STORAGE_KEY]: JSON.stringify({ clearAfterSend: true }),
  });

  assert.deepEqual(loadSettings(storage), { ...DEFAULT_SETTINGS, clearAfterSend: true });
  assert.equal(JSON.parse(storage.values.get(SETTINGS_STORAGE_KEY)).clearAfterSend, true);
});

test("merges partial persisted settings with defaults", () => {
  const storage = memoryStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({ clearAfterSend: true, reactContext: false }),
  });

  assert.deepEqual(loadSettings(storage), {
    ...DEFAULT_SETTINGS,
    clearAfterSend: true,
    reactContext: false,
  });
});

test("falls back to defaults for malformed storage", () => {
  const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: "{bad json" });

  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
});

test("ignores unknown keys and non-boolean values", () => {
  assert.deepEqual(
    normalizeSettings({
      pauseAnimationOnSelect: false,
      clearAfterSend: "yes",
      preventPageActions: 0,
      reactContext: true,
      markerColor: "blue",
    }),
    {
      ...DEFAULT_SETTINGS,
      pauseAnimationOnSelect: false,
      reactContext: true,
    },
  );
});

test("saves normalized settings under the v1 key", () => {
  const storage = memoryStorage();

  assert.equal(saveSettings({ ...DEFAULT_SETTINGS, clearAfterSend: true }, storage), true);
  assert.deepEqual(JSON.parse(storage.values.get(SETTINGS_STORAGE_KEY)), {
    ...DEFAULT_SETTINGS,
    clearAfterSend: true,
  });
});

test("reports unavailable storage without throwing", () => {
  const storage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  assert.equal(saveSettings(DEFAULT_SETTINGS, storage), false);
});

test("updates one known setting and preserves the rest", () => {
  assert.deepEqual(updateSetting(DEFAULT_SETTINGS, "preventPageActions", false), {
    ...DEFAULT_SETTINGS,
    preventPageActions: false,
  });
});
