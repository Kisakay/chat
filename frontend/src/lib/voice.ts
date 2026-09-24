/**
 * Voice: speech-to-text (composer) + text-to-speech (message playback).
 *
 * STT runs on the browser SpeechRecognition API when available
 * (Chrome/Edge); otherwise the mic is disabled with an explanatory tooltip.
 * TTS runs on speechSynthesis with per-user prefs (voice, rate, pitch,
 * language incl. auto-detect). Server-side whisper/piper binaries are the
 * documented future path (see docs) — no silent stub is shipped.
 */

export interface VoicePrefs {
  /** SpeechSynthesis voiceURI, or null = best match for the language. */
  voiceURI: string | null;
  rate: number;
  pitch: number;
  /** "auto" detects per message, otherwise forces a BCP-47 prefix. */
  lang: string;
}

const PREFS_KEY = "ka:voice";

export const DEFAULT_VOICE_PREFS: VoicePrefs = { voiceURI: null, rate: 1, pitch: 1, lang: "auto" };

export function getVoicePrefs(): VoicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<VoicePrefs> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_VOICE_PREFS };
    return {
      voiceURI: typeof raw.voiceURI === "string" ? raw.voiceURI : null,
      rate: typeof raw.rate === "number" && raw.rate >= 0.5 && raw.rate <= 2 ? raw.rate : 1,
      pitch: typeof raw.pitch === "number" && raw.pitch >= 0.5 && raw.pitch <= 2 ? raw.pitch : 1,
      lang: typeof raw.lang === "string" && raw.lang.length <= 12 ? raw.lang : "auto",
    };
  } catch {
    return { ...DEFAULT_VOICE_PREFS };
  }
}

export function setVoicePrefs(p: VoicePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

/** Naive per-message language guess (accents + stop-words). */
export function detectLang(text: string): string {
  const t = ` ${text.toLowerCase()} `;
  if (/[àâäéèêëîïôöùûüÿçœæ]/.test(text)) return "fr";
  const fr = [" le ", " la ", " les ", " un ", " une ", " des ", " est ", " sont ", " que ", " qui ", " pour ", " dans ", " avec ", " je ", " tu ", " vous ", " pas ", " plus ", " cette ", " comme "];
  const en = [" the ", " and ", " is ", " are ", " you ", " that ", " with ", " for ", " not ", " this ", " have ", " from "];
  let fs = 0;
  for (const w of fr) if (t.includes(w)) fs++;
  let es = 0;
  for (const w of en) if (t.includes(w)) es++;
  if (fs === 0 && es === 0) return "en";
  return fs >= es ? "fr" : "en";
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function listTtsVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const snapshot = synth.getVoices();
  if (snapshot.length > 0) return Promise.resolve(snapshot);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    // Some engines never fire the event after getVoices polling — bail out.
    setTimeout(done, 1500);
  });
}

export interface SpeakOpts {
  onstart?: () => void;
  onend?: () => void;
  onerror?: (msg: string) => void;
}

export type VoiceTimbre = "masculine" | "feminine" | "any";

export interface PreviewVoice {
  lang: string;
  rate: number;
  pitch: number;
  timbre: VoiceTimbre;
}

// Name fragments hinting a masculine / feminine voice (Chrome, Edge,
// Safari and Android voices carry such markers; absence falls back to
// any same-language voice — never an error).
const MASCULINE_HINTS = ["male", "homme", "masculin", "man", "garcon", "garçon", "david", "daniel", "thomas", "paul", "pierre", "jean", "marco", "jorge", "diego", "alex "];
const FEMININE_HINTS = ["female", "femme", "féminin", "feminin", "woman", "girl", "fille", "samantha", "marie", "sophie", "anna", "alice", "amelie", "amélie", "camille", "léa", "lea", "chloe", "chloé", "zira", "eva"];

/**
 * Pick a voice for a language + timbre character. Explicit URI wins, then
 * same-language voices matching the timbre hints, then any same-language
 * voice, then the engine default.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  opts: { lang: string; timbre?: VoiceTimbre; voiceURI?: string | null },
): SpeechSynthesisVoice | null {
  if (opts.voiceURI) {
    const exact = voices.find((v) => v.voiceURI === opts.voiceURI);
    if (exact) return exact;
  }
  const lang = opts.lang.toLowerCase();
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const pool = sameLang.length > 0 ? sameLang : voices;
  if (opts.timbre === "masculine" || opts.timbre === "feminine") {
    const hints = opts.timbre === "masculine" ? MASCULINE_HINTS : FEMININE_HINTS;
    const match = pool.find((v) => {
      const n = `${v.name} ${v.voiceURI}`.toLowerCase();
      return hints.some((h) => n.includes(h));
    });
    if (match) return match;
  }
  return pool.find((v) => v.default) ?? pool[0] ?? null;
}

/** Speak one message; cancels any current playback first. Returns false when unsupported. */
export function speak(text: string, prefs: VoicePrefs, voices: SpeechSynthesisVoice[], opts: SpeakOpts = {}): boolean {
  if (!ttsSupported()) return false;
  const synth = window.speechSynthesis;
  try {
    synth.cancel();
  } catch {
    // ignore
  }
  const lang = prefs.lang === "auto" ? detectLang(text) : prefs.lang;
  const utter = new SpeechSynthesisUtterance(text.slice(0, 2000));
  utter.lang = lang;
  utter.rate = prefs.rate;
  utter.pitch = prefs.pitch;
  const pick = pickVoice(voices, { lang, voiceURI: prefs.voiceURI });
  if (pick) utter.voice = pick;
  utter.onstart = () => opts.onstart?.();
  utter.onend = () => opts.onend?.();
  utter.onerror = (e) => opts.onerror?.(e.error || "error");
  try {
    synth.speak(utter);
  } catch {
    return false;
  }
  return true;
}

export function stopSpeak(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
}

/**
 * Play a preview line with ITS OWN voice character (timbre + rate + pitch),
 * never the user's global playback prefs — previews must sound different
 * from each other. Returns the resolved voice (null when unsupported) so
 * callers can offer "use this voice" adoption.
 */
export function speakPreview(
  text: string,
  preview: PreviewVoice,
  voices: SpeechSynthesisVoice[],
  opts: SpeakOpts = {},
): SpeechSynthesisVoice | null {
  if (!ttsSupported()) return null;
  const synth = window.speechSynthesis;
  try {
    synth.cancel();
  } catch {
    // ignore
  }
  const lang = preview.lang === "auto" ? detectLang(text) : preview.lang;
  const utter = new SpeechSynthesisUtterance(text.slice(0, 2000));
  utter.lang = lang;
  utter.rate = preview.rate;
  utter.pitch = preview.pitch;
  const pick = pickVoice(voices, { lang, timbre: preview.timbre });
  if (pick) utter.voice = pick;
  utter.onend = () => opts.onend?.();
  utter.onerror = () => opts.onerror?.("error");
  try {
    synth.speak(utter);
  } catch {
    return null;
  }
  return pick;
}

// --- speech recognition (STT) ---

export interface Recognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type RecognizerCtor = new () => Recognizer;

export function recognizerCtor(): RecognizerCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return ((w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as RecognizerCtor | null);
}

export function sttSupported(): boolean {
  return recognizerCtor() !== null;
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
