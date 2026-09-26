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
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private music: MusicBox | null = null;
  musicVolume = this.prefs.get('musicVolume');
  sfxVolume = this.prefs.get('sfxVolume');
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
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = this.sfxVolume;
      this.sfx.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0;
      this.musicBus.connect(this.master);
      this.music = new MusicBox(this.ctx, this.musicBus);
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

  setMusicVolume(v: number): void {
    this.musicVolume = Math.min(1, Math.max(0, v));
    this.prefs.set('musicVolume', this.musicVolume);
    if (this.music?.playing && this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.1);
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.min(1, Math.max(0, v));
    this.prefs.set('sfxVolume', this.sfxVolume);
    if (this.sfx && this.ctx) this.sfx.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.05);
  }

  /** Short preview so a volume slider gives immediate feedback. */
  previewSfx(): void {
    this.unlock();
    this.playRev(1.5);
  }

  previewMusic(): void {
    this.unlock();
    this.setMusicPlaying(true);
    setTimeout(() => this.setMusicPlaying(false), 2500);
  }

  /** The tune plays only while the simulation runs; it fades in and out. */
  setMusicPlaying(on: boolean): void {
    if (!this.ctx || !this.music || !this.musicBus) return;
    const t = this.ctx.currentTime;
    if (on && !this.music.playing) {
      this.music.start();
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.setTargetAtTime(this.musicVolume, t, 0.4);
    } else if (!on && this.music.playing) {
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.setTargetAtTime(0, t, 0.3);
      this.music.stop(t + 1.5);
    }
  }

  /**
   * Called once per rendered frame with the events of all ticks simulated in that frame.
   * There is deliberately no continuous background sound: only short, soft cues.
   */
  onFrame(events: SimEvent[], vehiclesOnMap: number, meanSpeed: number, running: boolean): void {
    if (!this.ctx || !this.master) return;
    this.setMusicPlaying(running && !this.muted);
    if (this.muted || !running) return;
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
    this.setMusicPlaying(false);
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
    noise.connect(bp).connect(g).connect(this.sfx!);
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
    osc.connect(og).connect(this.sfx!);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  playFinish(success: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.setMusicPlaying(false);
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
      osc.connect(g).connect(this.sfx!);
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
    noise.connect(lp).connect(g).connect(this.sfx!);
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
    noise.connect(bp).connect(g).connect(this.sfx!);
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

/**
 * A calm, looping tune synthesised on the fly: a soft pad playing a four-chord progression and a
 * sparse pentatonic melody. Deliberately slow and quiet so it never gets on the player's nerves.
 */
class MusicBox {
  playing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeatTime = 0;
  private beat = 0;
  private stopAt = Infinity;

  private static readonly BPM = 76;
  /** chords as MIDI notes, each held for 4 beats: C – Am – F – G, then C – Em – F – G */
  private static readonly CHORDS = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62], [60, 64, 67], [52, 55, 59], [53, 57, 60], [55, 59, 62]];
  /** 32 beats of melody (MIDI note or 0 = rest), C major pentatonic */
  private static readonly MELODY = [72, 0, 74, 76, 0, 72, 0, 0, 69, 0, 72, 0, 67, 0, 0, 0, 65, 67, 69, 0, 72, 0, 74, 0, 79, 0, 76, 0, 74, 72, 0, 0];

  constructor(private readonly ctx: AudioContext, private readonly out: GainNode) {}

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.stopAt = Infinity;
    this.beat = 0;
    this.nextBeatTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 200);
    this.schedule();
  }

  /** stops scheduling now and ends at `when` (after the fade-out) */
  stop(when: number): void {
    this.stopAt = when;
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const lookahead = this.ctx.currentTime + 0.6;
    const beatLen = 60 / MusicBox.BPM;
    while (this.nextBeatTime < lookahead && this.nextBeatTime < this.stopAt) {
      const t = this.nextBeatTime;
      if (this.beat % 4 === 0) this.pad(MusicBox.CHORDS[(this.beat / 4) % MusicBox.CHORDS.length], t, beatLen * 4);
      const note = MusicBox.MELODY[this.beat % MusicBox.MELODY.length];
      if (note) this.pluck(note, t, beatLen);
      this.beat++;
      this.nextBeatTime += beatLen;
    }
  }

  private static hz(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  private pad(notes: number[], t: number, dur: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.5);
    g.gain.setValueAtTime(0.05, t + dur - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.connect(lp).connect(this.out);
    for (const n of notes) {
      for (const detune of [-4, 4]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = MusicBox.hz(n - 12);
        osc.detune.value = detune;
        osc.connect(g);
        osc.start(t);
        osc.stop(t + dur + 0.4);
      }
    }
  }

  private pluck(midi: number, t: number, beatLen: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = MusicBox.hz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.9, beatLen * 1.4));
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 1);
  }
}
