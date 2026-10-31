"use client";

// STUDY CLASH — Web Audio sound engine.
// ---------------------------------------------------------------------------
// All effects are synthesized (oscillators + envelopes) so no audio files are
// needed. The AudioContext is created lazily and unlocked on the first user
// gesture to satisfy browser autoplay policies. Mute/volume persist in
// localStorage.
// ---------------------------------------------------------------------------

export type SoundName =
  | "click"
  | "select"
  | "toggle"
  | "success"
  | "join"
  | "leave"
  | "ready"
  | "countdown"
  | "countdownGo"
  | "question"
  | "urgent"
  | "lockIn"
  | "correct"
  | "wrong"
  | "reveal"
  | "ability"
  | "abilityOpponent"
  | "victory"
  | "defeat"
  | "draw"
  | "abandon"
  | "error"
  | "toast";

const MUTE_KEY = "sc:soundMuted";
const VOLUME_KEY = "sc:soundVolume";

interface ToneOpts {
  freq: number;
  endFreq?: number;
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  delay?: number;
  attack?: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private volume = 0.7;
  private listeners = new Set<() => void>();
  private unlocked = false;

  constructor() {
    if (typeof window === "undefined") return;
    try {
      this.muted = window.localStorage.getItem(MUTE_KEY) === "1";
      const raw = window.localStorage.getItem(VOLUME_KEY);
      const v = raw === null ? NaN : Number(raw);
      this.volume = Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
    } catch {
      /* localStorage unavailable — defaults apply */
    }
    // Unlock on the first user gesture (autoplay policy).
    const unlock = () => {
      this.ensureCtx();
      this.unlocked = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
  }

  private ensureCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  private applyGain() {
    if (this.master) {
      this.master.gain.value = this.muted ? 0 : this.volume;
    }
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get isMuted() {
    return this.muted;
  }
  get currentVolume() {
    return this.volume;
  }

  setMuted(value: boolean) {
    this.muted = value;
    try {
      window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
    } catch {
      /* ignore */
    }
    this.applyGain();
    this.notify();
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    try {
      window.localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      /* ignore */
    }
    this.applyGain();
    this.notify();
  }

  /** One synthesized tone. Returns false when audio is unavailable/muted. */
  private tone({ freq, endFreq, type = "sine", dur = 0.12, gain = 0.5, delay = 0, attack = 0.005 }: ToneOpts): boolean {
    if (this.muted) return false;
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return false;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * 0.6), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return true;
  }

  private noise(dur = 0.15, gain = 0.25, delay = 0, hp = 800): boolean {
    if (this.muted) return false;
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return false;
    const t0 = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    return true;
  }

  /** Play a named sound effect. Safe to call anywhere, anytime. */
  play(name: SoundName) {
    switch (name) {
      // ---- UI ----
      case "click":
        this.tone({ freq: 1250, endFreq: 950, type: "sine", dur: 0.05, gain: 0.16 });
        break;
      case "select":
        this.tone({ freq: 520, endFreq: 760, type: "triangle", dur: 0.09, gain: 0.3 });
        break;
      case "toggle":
        this.tone({ freq: 700, endFreq: 900, type: "square", dur: 0.06, gain: 0.12 });
        break;
      case "toast":
        this.tone({ freq: 880, endFreq: 660, type: "sine", dur: 0.12, gain: 0.2 });
        break;

      // ---- Lobby ----
      case "success":
        this.tone({ freq: 523.25, type: "triangle", dur: 0.12, gain: 0.35 });
        this.tone({ freq: 783.99, type: "triangle", dur: 0.22, gain: 0.35, delay: 0.1 });
        break;
      case "join":
        this.tone({ freq: 440, endFreq: 660, type: "triangle", dur: 0.14, gain: 0.35 });
        this.tone({ freq: 880, type: "sine", dur: 0.14, gain: 0.22, delay: 0.1 });
        break;
      case "leave":
        this.tone({ freq: 660, endFreq: 440, type: "triangle", dur: 0.16, gain: 0.3 });
        break;
      case "ready":
        this.tone({ freq: 987.77, type: "sine", dur: 0.09, gain: 0.32 });
        this.tone({ freq: 1318.51, type: "sine", dur: 0.16, gain: 0.28, delay: 0.08 });
        break;

      // ---- Match flow ----
      case "countdown":
        this.tone({ freq: 587.33, type: "square", dur: 0.09, gain: 0.22 });
        this.noise(0.04, 0.08, 0, 2000);
        break;
      case "countdownGo":
        this.tone({ freq: 880, endFreq: 1174.66, type: "square", dur: 0.25, gain: 0.3 });
        break;
      case "question":
        this.tone({ freq: 330, endFreq: 660, type: "sawtooth", dur: 0.16, gain: 0.14 });
        this.tone({ freq: 987.77, type: "sine", dur: 0.14, gain: 0.3, delay: 0.12 });
        break;
      case "urgent":
        this.tone({ freq: 1100, type: "square", dur: 0.06, gain: 0.16 });
        this.tone({ freq: 1100, type: "square", dur: 0.06, gain: 0.16, delay: 0.12 });
        break;
      case "lockIn":
        this.tone({ freq: 392, endFreq: 196, type: "triangle", dur: 0.1, gain: 0.4 });
        this.tone({ freq: 1046.5, type: "sine", dur: 0.1, gain: 0.25, delay: 0.03 });
        break;

      // ---- Round results ----
      case "correct":
        // Happy major arpeggio C5-E5-G5.
        this.tone({ freq: 523.25, type: "triangle", dur: 0.11, gain: 0.38 });
        this.tone({ freq: 659.25, type: "triangle", dur: 0.11, gain: 0.38, delay: 0.09 });
        this.tone({ freq: 783.99, type: "triangle", dur: 0.2, gain: 0.4, delay: 0.18 });
        break;
      case "wrong":
        // Descending buzz.
        this.tone({ freq: 311.13, endFreq: 207.65, type: "sawtooth", dur: 0.16, gain: 0.3 });
        this.tone({ freq: 233.08, endFreq: 155.56, type: "sawtooth", dur: 0.24, gain: 0.3, delay: 0.12 });
        break;
      case "reveal":
        this.noise(0.22, 0.14, 0, 1400);
        this.tone({ freq: 220, endFreq: 440, type: "sine", dur: 0.18, gain: 0.16 });
        break;

      // ---- Abilities ----
      case "ability":
        this.tone({ freq: 200, endFreq: 1600, type: "square", dur: 0.18, gain: 0.22 });
        this.tone({ freq: 1200, endFreq: 2400, type: "sine", dur: 0.14, gain: 0.25, delay: 0.08 });
        break;
      case "abilityOpponent":
        this.tone({ freq: 500, endFreq: 250, type: "square", dur: 0.16, gain: 0.16 });
        break;

      // ---- Endgame ----
      case "victory":
        // Fanfare: G4 C5 E5 G5 + chord.
        this.tone({ freq: 392, type: "triangle", dur: 0.12, gain: 0.4 });
        this.tone({ freq: 523.25, type: "triangle", dur: 0.12, gain: 0.4, delay: 0.11 });
        this.tone({ freq: 659.25, type: "triangle", dur: 0.12, gain: 0.4, delay: 0.22 });
        this.tone({ freq: 783.99, type: "triangle", dur: 0.26, gain: 0.44, delay: 0.33 });
        this.tone({ freq: 1046.5, type: "sine", dur: 0.4, gain: 0.3, delay: 0.33 });
        break;
      case "defeat":
        // Sad minor descent.
        this.tone({ freq: 440, type: "triangle", dur: 0.16, gain: 0.34 });
        this.tone({ freq: 349.23, type: "triangle", dur: 0.16, gain: 0.34, delay: 0.15 });
        this.tone({ freq: 261.63, type: "triangle", dur: 0.34, gain: 0.36, delay: 0.3 });
        break;
      case "draw":
        this.tone({ freq: 493.88, type: "triangle", dur: 0.14, gain: 0.32 });
        this.tone({ freq: 493.88, type: "triangle", dur: 0.2, gain: 0.32, delay: 0.16 });
        break;
      case "abandon":
        this.tone({ freq: 440, endFreq: 174.61, type: "sine", dur: 0.5, gain: 0.26 });
        break;
      case "error":
        this.tone({ freq: 220, endFreq: 180, type: "sawtooth", dur: 0.14, gain: 0.2 });
        break;
    }
  }
}

/** Global singleton — import and call `sounds.play("correct")`. */
export const sounds = new SoundEngine();

// ---------------------------------------------------------------------------
// React binding hook (optional — for UI toggles).
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";

export function useSoundPrefs() {
  const [muted, setMuted] = useState(() => sounds.isMuted);
  const [volume, setVolume] = useState(() => sounds.currentVolume);

  useEffect(() => {
    const unsub = sounds.subscribe(() => {
      setMuted(sounds.isMuted);
      setVolume(sounds.currentVolume);
    });
    return unsub;
  }, []);

  return {
    muted,
    volume,
    toggleMuted: () => sounds.setMuted(!sounds.isMuted),
    setMuted: (v: boolean) => sounds.setMuted(v),
    setVolume: (v: number) => sounds.setVolume(v),
  };
}
