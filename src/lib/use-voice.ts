'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser-native voice I/O for the chat agent.
 *
 * - Speech recognition (STT): Web Speech API (SpeechRecognition).
 *   Supported in Chrome/Edge/Safari. Free, on-device or cloud-backed by
 *   the browser. No API key required.
 * - Speech synthesis (TTS): Web Speech API (speechSynthesis). Free.
 *
 * Voice mode (the killer UX):
 *   When `voiceMode === true`, the hook drives a hands-free phone-call loop:
 *     1. Agent reply arrives → caller invokes `speak(text)`.
 *     2. Browser speaks the text. While speaking, `speaking === true`.
 *     3. When TTS finishes, the mic auto-starts listening (after a small
 *        natural pause).
 *     4. Patient speaks → recogniser accumulates → user stops mic (manually)
 *        or one of the silence-end paths fires → transcript sent.
 *     5. Cycle repeats until voice mode is turned off.
 *   Tapping the mic mid-speech *interrupts* the agent and starts listening
 *   immediately — like talking over someone on the phone.
 *
 * Listening behaviour:
 *  - `continuous = true` so the recogniser keeps listening across pauses.
 *    Patients pause mid-sentence; we don't want to send a half-thought.
 *  - We accumulate finalised segments locally; the message is only sent
 *    when the user explicitly stops (clicks the mic again).
 *  - If the browser auto-ends the recogniser (Chrome will after a stretch
 *    even in continuous mode), we transparently restart it as long as the
 *    user hasn't stopped.
 *
 * Limitations: SpeechRecognition has spotty Firefox support; the UI shows
 * a fallback text input regardless. For a real product we'd swap this for
 * Vapi (telephony) or Deepgram + ElevenLabs (browser, higher quality),
 * keeping this hook's interface stable.
 */

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// How long the mic waits in silence before auto-stopping and sending what it
// has. 1500ms is responsive enough for a phone-call feel while still tolerating
// natural patient pauses. Override via the hook option.
const DEFAULT_SILENCE_MS = 1500;

// Minimum useful transcript length. Single-character bleeps from noise get
// filtered. We keep "yes/no/ok/hi" intact via the regex below.
const NOISE_KEEP_REGEX =
  /\b(yes|yeah|yep|no|nope|nah|ok|okay|sure|hi|hey|thanks|done)\b/i;
function looksLikeNoise(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return true;
  // Has a meaningful word? (longer than 2 chars, OR matches the keep list)
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hasMeaningful =
    words.some((w) => w.length >= 3) || NOISE_KEEP_REGEX.test(t);
  return !hasMeaningful;
}

export function useVoice(opts: {
  onTranscript: (final: string) => void;
  /** Auto-stop the mic after this many ms of no transcript activity. */
  silenceMs?: number;
}) {
  const silenceMs = opts.silenceMs ?? DEFAULT_SILENCE_MS;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [voiceMode, setVoiceModeState] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const accumulatedRef = useRef<string>('');
  const userStoppedRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<number | null>(null);
  // Picked once when the browser's voice list loads, then locked. Re-using
  // this across utterances guarantees the patient hears the same person.
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Mirror voiceMode + listening into refs so callbacks captured by browser
  // APIs (onend, utterance.onend) always see the latest values.
  const voiceModeRef = useRef(voiceMode);
  const listeningRef = useRef(listening);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  const onTranscriptRef = useRef(opts.onTranscript);
  useEffect(() => {
    onTranscriptRef.current = opts.onTranscript;
  }, [opts.onTranscript]);

  useEffect(() => {
    setSupported(
      getSpeechRecognitionCtor() !== null &&
        typeof window !== 'undefined' &&
        'speechSynthesis' in window,
    );
  }, []);

  // Lock a TTS voice once the browser has them loaded. In Chrome/Edge,
  // getVoices() initially returns []; the 'voiceschanged' event fires once
  // the list is ready. Picking once and re-using guarantees the patient
  // doesn't hear different voices for different replies.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return false;
      if (preferredVoiceRef.current) return true;

      const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
      const pool = englishVoices.length > 0 ? englishVoices : voices;

      // Ordered preference list — pick the first match that exists locally.
      const patterns = [
        /samantha/i,
        /microsoft jenny/i,
        /microsoft aria/i,
        /microsoft ava/i,
        /google us english/i,
        /^jenny$/i,
        /^en-us/i,
      ];
      for (const re of patterns) {
        const v = pool.find((x) => re.test(x.name) || re.test(x.lang));
        if (v) {
          preferredVoiceRef.current = v;
          return true;
        }
      }
      // Fallback: first English voice, or first voice overall.
      preferredVoiceRef.current = pool[0] ?? null;
      return preferredVoiceRef.current !== null;
    };

    if (!pick()) {
      const handler = () => {
        pick();
      };
      window.speechSynthesis.addEventListener('voiceschanged', handler);
      return () =>
        window.speechSynthesis.removeEventListener('voiceschanged', handler);
    }
  }, []);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const armSilenceTimer = () => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      // Silence threshold reached — auto-stop and emit whatever we have.
      // The recogniser's onend will run and apply the noise filter.
      if (recRef.current && !userStoppedRef.current) {
        userStoppedRef.current = true;
        try {
          recRef.current.stop();
        } catch {
          /* ignore */
        }
      }
    }, silenceMs);
  };

  // Forward declaration so speak/start can refer to each other through refs.
  const startRecognitionImplRef = useRef<() => SpeechRecognitionLike | null>(
    () => null,
  );

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return null;

    // Defensively cancel any in-progress speech — we should never be both
    // speaking and listening; whichever started later wins.
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }

    const r = new Ctor();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = true;

    r.onresult = (e) => {
      let interimText = '';
      let gotAny = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          accumulatedRef.current = (
            accumulatedRef.current +
            ' ' +
            res[0].transcript
          ).trim();
          gotAny = true;
        } else if (res[0].transcript.trim().length > 0) {
          interimText += res[0].transcript;
          gotAny = true;
        }
      }
      const live = (accumulatedRef.current + ' ' + interimText).trim();
      setInterim(live);
      // Re-arm the silence timer on any speech activity. If the user goes
      // quiet for `silenceMs`, the timer fires and auto-stops the mic.
      if (gotAny) armSilenceTimer();
    };

    r.onend = () => {
      clearSilenceTimer();
      if (userStoppedRef.current) {
        const finalText = accumulatedRef.current.trim();
        accumulatedRef.current = '';
        setInterim('');
        setListening(false);
        recRef.current = null;
        // Drop noise — clearing throats, background TV, etc.
        if (!finalText || looksLikeNoise(finalText)) return;
        onTranscriptRef.current(finalText);
        return;
      }
      window.setTimeout(() => {
        if (userStoppedRef.current) return;
        try {
          const next = startRecognitionImplRef.current?.();
          if (!next) {
            const finalText = accumulatedRef.current.trim();
            accumulatedRef.current = '';
            setInterim('');
            setListening(false);
            recRef.current = null;
            if (finalText && !looksLikeNoise(finalText))
              onTranscriptRef.current(finalText);
          }
        } catch {
          setListening(false);
        }
      }, 80);
    };

    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      clearSilenceTimer();
      userStoppedRef.current = true;
      accumulatedRef.current = '';
      setInterim('');
      setListening(false);
      recRef.current = null;
    };

    recRef.current = r;
    try {
      r.start();
    } catch {
      return null;
    }
    return r;
  }, []);

  useEffect(() => {
    startRecognitionImplRef.current = startRecognition;
  }, [startRecognition]);

  const start = useCallback(() => {
    if (!getSpeechRecognitionCtor()) return;
    accumulatedRef.current = '';
    userStoppedRef.current = false;
    setInterim('');
    setListening(true);
    startRecognition();
    // Arm silence timer so a no-speech start (mic opens but patient doesn't
    // talk) auto-closes after `silenceMs`. Without this an open mic with no
    // user input would hang forever.
    armSilenceTimer();
  }, [startRecognition]);

  const stop = useCallback(() => {
    clearSilenceTimer();
    userStoppedRef.current = true;
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      if (!voiceModeRef.current) return;
      // Don't try to speak over the user; if mic is live, the agent already
      // had its turn and we shouldn't interrupt them.
      if (listeningRef.current) return;

      // Cancel anything queued — only the latest reply should be heard.
      window.speechSynthesis.cancel();

      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.pitch = 1.0;
      // Use the voice we locked at hook init — guarantees a single voice
      // identity across the entire session.
      if (preferredVoiceRef.current) u.voice = preferredVoiceRef.current;

      u.onstart = () => setSpeaking(true);
      u.onend = () => {
        setSpeaking(false);
        // Hands-free: agent finished talking — open the mic so the patient
        // can reply without touching anything.
        if (voiceModeRef.current && !listeningRef.current) {
          window.setTimeout(() => {
            if (voiceModeRef.current && !listeningRef.current) start();
          }, 250);
        }
      };
      u.onerror = () => setSpeaking(false);

      window.speechSynthesis.speak(u);
    },
    [start],
  );

  // Public setter — when leaving voice mode, also cancel any in-flight speech
  // and stop listening so the app doesn't stay "live" after the toggle is off.
  const setVoiceMode = useCallback(
    (next: boolean) => {
      setVoiceModeState(next);
      if (!next) {
        cancelSpeech();
        if (listeningRef.current) {
          userStoppedRef.current = true;
          try {
            recRef.current?.stop();
          } catch {
            /* ignore */
          }
        }
      }
    },
    [cancelSpeech],
  );

  return {
    supported,
    listening,
    interim,
    speaking,
    voiceMode,
    setVoiceMode,
    start,
    stop,
    speak,
    cancelSpeech,
  };
}
