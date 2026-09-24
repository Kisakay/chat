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
  /** Playback engine: neural server TTS when available, else browser. */
  engine: "auto" | "browser" | "server";
  /** Server neural voice id (ElevenLabs voice_id / OpenAI voice name). */
  serverVoice: string | null;
}

const PREFS_KEY = "ka:voice";

export const DEFAULT_VOICE_PREFS: VoicePrefs = { voiceURI: null, rate: 1, pitch: 1, lang: "auto", engine: "auto", serverVoice: null };

export function getVoicePrefs(): VoicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<VoicePrefs> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_VOICE_PREFS };
    const engine = raw.engine === "browser" || raw.engine === "server" ? raw.engine : "auto";
    return {
      voiceURI: typeof raw.voiceURI === "string" ? raw.voiceURI : null,
      rate: typeof raw.rate === "number" && raw.rate >= 0.5 && raw.rate <= 2 ? raw.rate : 1,
      pitch: typeof raw.pitch === "number" && raw.pitch >= 0.5 && raw.pitch <= 2 ? raw.pitch : 1,
      lang: typeof raw.lang === "string" && raw.lang.length <= 12 ? raw.lang : "auto",
      engine,
      serverVoice: typeof raw.serverVoice === "string" && raw.serverVoice.length > 0 ? raw.serverVoice : null,
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

/** Stock OpenAI voices (static catalog — selectable even before any key). */
export const OPENAI_STATIC_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

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

// --- unified playback (neural server audio with browser fallback) ---

export interface PlayHandle {
  /** Engine that ended up playing (may differ from the request in auto). */
  engine: "server" | "browser";
  stop: () => void;
  done: Promise<void>;
}

let currentAudio: HTMLAudioElement | null = null;

function stopCurrentAudio(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      const url = currentAudio.src;
      currentAudio.removeAttribute("src");
      currentAudio.load();
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
    currentAudio = null;
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
}

/** Stop whatever is playing (server audio or browser speech). */
export function stopPlayback(): void {
  stopCurrentAudio();
}

export interface PlayRequest {
  text: string;
  /** "server" forces neural, "browser" forces synthesis, "auto" tries neural first. */
  engine: "auto" | "browser" | "server";
  browser: {
    voices: SpeechSynthesisVoice[];
    /** "auto" detects per text, otherwise a BCP-47 prefix. */
    lang: string;
    rate: number;
    pitch: number;
    /** Explicit voice URI (user pref); otherwise timbre-matched. */
    voiceURI?: string | null;
    /** Preview character timbre (ignored when voiceURI is set). */
    timbre?: VoiceTimbre;
  };
  /** Server neural voice id (preview line voice or user serverVoice). */
  serverVoice?: string | null;
  /** True when the platform TTS tool is available. */
  serverAvailable: boolean;
  fetchAudio: (text: string, voice?: string) => Promise<Blob>;
  onstart?: () => void;
  onend?: () => void;
  onerror?: (msg: string) => void;
}

/**
 * Play one text with the best engine: neural server audio when requested
 * and available (shared <audio> element, user speed), otherwise the
 * browser character voice. Single global playback — a new play stops the
 * previous one. `done` resolves when playback fully ends (fallback
 * included); it never rejects (errors go to onend/onerror like speech).
 */
export function playText(req: PlayRequest): PlayHandle {
  stopPlayback();
  const wantServer = req.serverAvailable && req.engine !== "browser";
  if (wantServer) return playServer(req, req.engine === "auto");
  return playBrowser(req);
}

function playServer(req: PlayRequest, allowFallback: boolean): PlayHandle {
  let settled = false;
  const stop = () => {
    settled = true;
    stopCurrentAudio();
  };
  const done = (async () => {
    try {
      const blob = await req.fetchAudio(req.text.slice(0, 2000), req.serverVoice ?? undefined);
      if (settled) return;
      await playAudioBlob(blob, req, () => settled);
    } catch (e) {
      if (settled) return;
      if (allowFallback) {
        await playBrowserAudio(req, () => settled);
        return;
      }
      req.onerror?.(e instanceof Error ? e.message : "playback failed");
    }
  })();
  return { engine: "server", stop, done };
}

function playAudioBlob(blob: Blob, req: PlayRequest, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = req.browser.rate;
    currentAudio = audio;
    const finish = (ok: boolean) => {
      if (currentAudio === audio) stopCurrentAudio();
      else {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      if (!cancelled() && ok) req.onend?.();
      resolve();
    };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    req.onstart?.();
    audio.play().catch(() => finish(false));
  });
}

function playBrowser(req: PlayRequest): PlayHandle {
  let settled = false;
  const stop = () => {
    settled = true;
    stopSpeak();
  };
  const done = playBrowserAudio(req, () => settled);
  return { engine: "browser", stop, done };
}

function playBrowserAudio(req: PlayRequest, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const b = req.browser;
    const lang = b.lang === "auto" ? detectLang(req.text) : b.lang;
    const explicit = b.voiceURI ? b.voices.find((v) => v.voiceURI === b.voiceURI) : undefined;
    const pick = explicit ?? pickVoice(b.voices, { lang, timbre: b.timbre ?? "any" });
    const finish = (ok: boolean, msg?: string) => {
      if (cancelled()) {
        resolve();
        return;
      }
      if (ok) req.onend?.();
      else req.onerror?.(msg ?? "error");
      resolve();
    };
    const ok = speak(
      req.text,
      { voiceURI: pick?.voiceURI ?? null, rate: b.rate, pitch: b.pitch, lang, engine: "browser", serverVoice: null },
      b.voices,
      { onstart: () => req.onstart?.(), onend: () => finish(true), onerror: (m) => finish(false, m) },
    );
    if (!ok) finish(false, "unsupported");
  });
}

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
