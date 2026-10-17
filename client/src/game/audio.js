export class GameAudio {
  constructor() {
    this.enabled = true;
    this.musicEnabled = true;
    this.context = null;
    this.ambience = null;
    this.master = null;
  }

  start() {
    if (!this.enabled && !this.musicEnabled) return;
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') this.context.resume();
    if (!this.master) {
      this.master = this.context.createGain();
      this.master.gain.value = 0.12;
      this.master.connect(this.context.destination);
    }
    if (this.musicEnabled && !this.ambience) this.startAmbience();
  }

  startAmbience() {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = 'sine';
    oscillator.frequency.value = 82;
    filter.type = 'lowpass';
    filter.frequency.value = 150;
    gain.gain.value = 0.12;
    oscillator.connect(filter).connect(gain).connect(this.master);
    oscillator.start();
    this.ambience = { oscillator, gain };
  }

  setMusic(enabled) {
    this.musicEnabled = enabled;
    if (enabled) this.start();
    else if (this.ambience) {
      this.ambience.oscillator.stop();
      this.ambience = null;
    }
  }

  tone(frequency, duration, type = 'sine', volume = 0.35) {
    if (!this.enabled) return;
    this.start();
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(50, frequency * 0.62), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  fart() { this.tone(105 + Math.random() * 80, 0.18 + Math.random() * 0.12, 'sawtooth', 0.18); }
  splash() { this.tone(360, 0.22, 'triangle', 0.25); }
  win() { [523, 659, 784].forEach((note, index) => window.setTimeout(() => this.tone(note, 0.32, 'triangle', 0.28), index * 120)); }
  lose() { [300, 245, 190].forEach((note, index) => window.setTimeout(() => this.tone(note, 0.24, 'sine', 0.22), index * 150)); }
}
