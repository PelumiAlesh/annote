// Pure dictation contracts for Annote comment composer voice input.
// No DOM, no browser APIs — the annotator owns rendering/recognition,
// this module owns the state model, visibility matrix, merge rule, and copy.

export type DictationStatus = "idle" | "listening" | "transcribing";

export type DictationErrorKind =
  | "denied"
  | "unavailable"
  | "no-speech"
  | "recognition"
  | "network";

export type ComposerControls = {
  /** Top-field elements in order. */
  top: Array<"input" | "mic" | "send" | "voice-cancel" | "waveform" | "stop" | "transcribing">;
  /** Footer left group, or null when collapsed. */
  footerLeft: Array<"cancel" | "undo" | "delete"> | null;
  /** Footer right group, or null when collapsed. */
  footerRight: Array<"mic" | "save"> | null;
  /** Save/Add + icon send are inert while dictation is active. */
  saveDisabled: boolean;
};

export type ComposerControlInput = {
  expanded: boolean;
  /** Editing a persisted annotation (Save) vs new (Add). */
  isExisting: boolean;
  hasText: boolean;
  dictation: DictationStatus;
  micSupported: boolean;
};

export function composerControls(input: ComposerControlInput): ComposerControls {
  const { expanded, isExisting, hasText, dictation, micSupported } = input;
  if (dictation === "listening") {
    return {
      top: ["voice-cancel", "waveform", "stop"],
      footerLeft: expanded ? ["cancel", "undo", ...(isExisting ? ["delete" as const] : [])] : null,
      footerRight: expanded ? ["save"] : null,
      saveDisabled: true,
    };
  }
  if (dictation === "transcribing") {
    return {
      top: ["voice-cancel", "transcribing"],
      footerLeft: expanded ? ["cancel", "undo", ...(isExisting ? ["delete" as const] : [])] : null,
      footerRight: expanded ? ["save"] : null,
      saveDisabled: true,
    };
  }
  const mic = micSupported ? (["mic"] as const) : [];
  // Expanded owns mic+save in the footer; the top stays a plain input.
  // Collapsed keeps mic (+send when text exists) in the top field.
  return {
    top: expanded ? ["input"] : ["input", ...mic, ...(hasText ? (["send"] as const) : [])],
    footerLeft: expanded ? ["cancel", "undo", ...(isExisting ? ["delete" as const] : [])] : null,
    footerRight: expanded ? [...(micSupported ? (["mic"] as const) : []), "save"] : null,
    saveDisabled: false,
  };
}

export function mergeTranscript(existing: string, transcript: string): string {
  const clean = transcript.replace(/\s+/g, " ").trim();
  if (!clean) return existing;
  if (!existing.trim()) return clean;
  return `${existing.trimEnd()} ${clean}`;
}

export function dictationErrorCopy(kind: DictationErrorKind): string {
  if (kind === "denied") return "Microphone access denied.";
  if (kind === "unavailable") return "Microphone unavailable.";
  if (kind === "no-speech") return "No speech detected.";
  if (kind === "network") return "Transcription unavailable. Check your connection.";
  return "Couldn’t transcribe that.";
}

export type DictationCaps = {
  speechRecognition?: unknown;
  getUserMedia?: unknown;
};

/** Microphone input only: SpeechRecognition + getUserMedia({ audio: true }). */
export function probeDictationSupport(caps: DictationCaps): boolean {
  return !!caps.speechRecognition && typeof caps.getUserMedia === "function";
}

export function probeBrowserDictationSupport(): boolean {
  const w = window as unknown as Record<string, unknown>;
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  const getUserMedia = navigator?.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  return probeDictationSupport({ speechRecognition: SR, getUserMedia });
}
