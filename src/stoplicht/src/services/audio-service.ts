import { resolve } from 'aurelia';
import type { SimEvent } from '../sim';
import { PreferencesStore } from './preferences-store';

/**
 * All game audio, synthesised on the fly with the Web Audio API (no audio files).
 * The context is created lazily on the first user gesture (start button).
 */
export class AudioService {
  private readonly prefs = resolve(PreferencesStore);
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private brownBuffer: AudioBuffer | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastBrake = 0;
  private lastStart = 0;
  muted = this.prefs.get('muted');

  /** Create/resume the context; call from a user gesture. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.prefs.set('muted', muted);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  toggleMuted(): void {
    this.setMuted(!this.muted);
  }

  /**
   * Called once per rendered frame with the events of all ticks simulated in that frame.
   * There is deliberately no continuous background sound: only short, soft cues.
   */
  onFrame(events: SimEvent[], vehiclesOnMap: number, meanSpeed: number, running: boolean): void {
    if (!this.ctx || !this.master || this.muted || !running) return;
    void vehiclesOnMap;
    void meanSpeed;
    const now = this.ctx.currentTime;
    let starts = 0;
    let stops = 0;
    for (const e of events) {
      if (e.type === 'start') starts++;
      else if (e.type === 'stop') stops++;
    }
    if (starts > 0 && now - this.lastStart > 1.0) {
      this.lastStart = now;
      this.playRev(Math.min(3, starts));
    }
    if (stops > 0 && now - this.lastBrake > 1.0) {
      this.lastBrake = now;
      this.playBrake(Math.min(3, stops));
    }
  }

  playCrash(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    // metallic noise burst
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1200, t);
    bp.frequency.exponentialRampToValueAtTime(200, t + 0.6);
    bp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    noise.connect(bp).connect(g).connect(this.master);
    noise.start(t);
    noise.stop(t + 0.75);
    // low thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  playFinish(success: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const notes = success ? [523.25, 659.25, 783.99, 1046.5] : [440, 349.23];
    const dur = success ? 0.14 : 0.35;
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const start = t + i * dur;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + dur * (i === notes.length - 1 ? 3 : 1.1));
      osc.connect(g).connect(this.master!);
      osc.start(start);
      osc.stop(start + dur * 3.2);
    });
  }

  /** Vehicle pulling away: a soft, slow swell of low-passed noise (no sharp attack). */
  private playRev(intensity: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.getBrownNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.linearRampToValueAtTime(420, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025 * Math.min(intensity, 2), t + 0.25);
    g.gain.linearRampToValueAtTime(0, t + 0.9);
    noise.connect(lp).connect(g).connect(this.master!);
    noise.start(t, Math.random() * 0.5);
    noise.stop(t + 1);
  }

  /** Vehicle coming to a stop: a gentle hiss that fades, wide filter so it never rings. */
  private playBrake(intensity: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.linearRampToValueAtTime(700, t + 0.5);
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.006 * Math.min(intensity, 2), t + 0.12);
    g.gain.linearRampToValueAtTime(0, t + 0.55);
    noise.connect(bp).connect(g).connect(this.master!);
    noise.start(t, Math.random() * 0.4);
    noise.stop(t + 0.6);
  }

  private getBrownNoise(): AudioBuffer {
    const ctx = this.ctx!;
    if (!this.brownBuffer) {
      const length = ctx.sampleRate * 2;
      this.brownBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.brownBuffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = last * 3.5;
      }
    }
    return this.brownBuffer;
  }

  private getNoise(): AudioBuffer {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) {
      const length = ctx.sampleRate;
      this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuffer;
  }
}
