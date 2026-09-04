import assert from "node:assert/strict";
import test from "node:test";

import {
  composerControls,
  dictationErrorCopy,
  mergeTranscript,
  probeDictationSupport,
} from "/tmp/feedback-mark-dictation.mjs";

const base = { expanded: false, isExisting: false, hasText: false, dictation: "idle", micSupported: true };

test("collapsed empty: input + mic, no send, no footer", () => {
  assert.deepEqual(composerControls(base), {
    top: ["input", "mic"],
    footerLeft: null,
    footerRight: null,
    saveDisabled: false,
  });
});

test("collapsed with text: mic + send coexist", () => {
  const controls = composerControls({ ...base, hasText: true });
  assert.deepEqual(controls.top, ["input", "mic", "send"]);
  assert.equal(controls.saveDisabled, false);
});

test("collapsed listening: X + waveform + stop, no send, no footer", () => {
  assert.deepEqual(composerControls({ ...base, dictation: "listening" }), {
    top: ["voice-cancel", "waveform", "stop"],
    footerLeft: null,
    footerRight: null,
    saveDisabled: true,
  });
});

test("collapsed transcribing: X + transcribing, save locked", () => {
  assert.deepEqual(composerControls({ ...base, dictation: "transcribing" }), {
    top: ["voice-cancel", "transcribing"],
    footerLeft: null,
    footerRight: null,
    saveDisabled: true,
  });
});

test("expanded new idle: mic stays with input, cancel/undo left, add right", () => {
  assert.deepEqual(composerControls({ ...base, expanded: true }), {
    top: ["input", "mic"],
    footerLeft: ["cancel", "undo"],
    footerRight: ["save"],
    saveDisabled: false,
  });
});

test("expanded existing idle adds delete while mic remains in the input", () => {
  const controls = composerControls({ ...base, expanded: true, isExisting: true });
  assert.deepEqual(controls.footerLeft, ["cancel", "undo", "delete"]);
  assert.deepEqual(controls.top, ["input", "mic"]);
  assert.deepEqual(controls.footerRight, ["save"]);
});

test("expanded listening: top owns state, footer mic gone, save locked", () => {
  const controls = composerControls({ ...base, expanded: true, isExisting: true, dictation: "listening" });
  assert.deepEqual(controls.top, ["voice-cancel", "waveform", "stop"]);
  assert.ok(!controls.footerRight.includes("mic"), "second mic stream trigger");
  assert.equal(controls.saveDisabled, true);
});

test("expanded transcribing mirrors listening lock", () => {
  const controls = composerControls({ ...base, expanded: true, dictation: "transcribing" });
  assert.deepEqual(controls.top, ["voice-cancel", "transcribing"]);
  assert.equal(controls.saveDisabled, true);
});

test("unsupported browsers lose mic everywhere, never crash", () => {
  assert.deepEqual(composerControls({ ...base, micSupported: false }).top, ["input"]);
  assert.deepEqual(composerControls({ ...base, expanded: true, micSupported: false }).footerRight, ["save"]);
  assert.equal(probeDictationSupport({}), false);
  assert.equal(probeDictationSupport({ speechRecognition: {}, getUserMedia: () => {} }), true);
  assert.equal(probeDictationSupport({ speechRecognition: {} }), false);
});

test("merge appends with a space, never overwrites", () => {
  assert.equal(mergeTranscript("", "hello world"), "hello world");
  assert.equal(mergeTranscript("  ", "hi"), "hi");
  assert.equal(mergeTranscript("Make it red", "and bigger"), "Make it red and bigger");
  assert.equal(mergeTranscript("note", "  spaced   out  "), "note spaced out");
  assert.equal(mergeTranscript("keep", ""), "keep");
});

test("error copy is concise and local", () => {
  assert.equal(dictationErrorCopy("denied"), "Microphone access denied.");
  assert.equal(dictationErrorCopy("unavailable"), "Microphone unavailable.");
  assert.equal(dictationErrorCopy("no-speech"), "No speech detected.");
  assert.ok(dictationErrorCopy("recognition").length < 60);
});
