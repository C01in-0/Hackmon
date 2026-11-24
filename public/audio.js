import { base } from './paths.js';
const tracks = ['normal', 'champion', 'boss'];
// Small, element-specific voices; menu beeps remain silent.
const cinematic = new Set(['erasure', 'collapse', 'league-loss', 'boss-loss']);
const effects = new Set([...cinematic, 'cast-fire', 'cast-water', 'cast-grass', 'cast-spark',
  'cast-boss-rift', 'cast-boss-erase', 'cast-boss-pulse', 'guard', 'break']);
const key = 't1-audio-v1';
const format = typeof Audio !== 'undefined' && new Audio().canPlayType?.('audio/ogg; codecs="vorbis"') ? 'ogg' : 'wav';
const mediaUrl = name => `${base}audio/${name}.${format}?v=20261026`;

export class GameAudio {
  constructor() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
    this.enabled = saved.enabled !== false;
    this.volume = Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : .55;
    this.effectsEnabled = saved.effectsEnabled !== false;
    this.effectsVolume = Number.isFinite(saved.effectsVolume) ? Math.max(0,Math.min(1,saved.effectsVolume)) : .45;
    this.unlocked = false;
    this.sceneName = 'normal';
    this.music = Object.fromEntries(tracks.map(name => {
      const item = new Audio();
      item.loop = true;
      item.preload = 'none';
      return [name, item];
    }));
    this.lastEffectAt = 0;
    this.activeEffects = new Set();
    this.musicDucks = new Map();
    this.applyVolume();
  }

  save() { localStorage.setItem(key, JSON.stringify({ enabled: this.enabled, volume: this.volume, effectsEnabled: this.effectsEnabled, effectsVolume: this.effectsVolume })); }
  applyVolume() {
    const duck = Math.min(1, ...this.musicDucks.values());
    for (const item of Object.values(this.music)) item.volume = this.volume * .47 * duck;
    for (const item of this.activeEffects) item.volume = this.effectsVolume * (item.cinematic ? .82 : item.guard ? .18 : .42);
  }
  duckMusic(factor = .2) {
    const token = Symbol('music-duck');
    this.musicDucks.set(token, Math.max(0, Math.min(1, factor)));
    this.applyVolume();
    return () => { this.musicDucks.delete(token); this.applyVolume(); };
  }
  async unlock() {
    this.unlocked = true;
    if (this.enabled) {
      // Playback is optional and never gates saving, screening or a match.
      void this.playCurrent();
    }
  }
  async playCurrent() {
    for (const [name, item] of Object.entries(this.music)) if (name !== this.sceneName) item.pause();
    const active = this.music[this.sceneName];
    if (!this.unlocked || !this.enabled || !active) return;
    if (!active.src) active.src = mediaUrl(this.sceneName);
    try { await active.play(); } catch { /* Browser still needs an interaction. The control stays available. */ }
  }
  scene(name) {
    if (name === this.sceneName) return;
    this.sceneName = name;
    if (name === 'boss') this.music.boss.currentTime = 0;
    for (const item of Object.values(this.music)) item.pause();
    void this.playCurrent();
  }
  toggle() {
    if (!this.unlocked) { this.unlocked = true; this.enabled = true; }
    else this.enabled = !this.enabled;
    this.save();
    if (this.enabled) void this.playCurrent();
    else { for (const item of Object.values(this.music)) item.pause(); }
  }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, Number(value))); this.applyVolume(); this.save(); }
  stopEffects() { for (const item of this.activeEffects) item.pause(); this.activeEffects.clear(); }
  effect(name, force = false, { rate = 1, signal } = {}) {
    if (!effects.has(name) || !this.unlocked || !this.effectsEnabled || signal?.aborted) return;
    const now = performance.now();
    if (!force && now - this.lastEffectAt < 100) return;
    this.lastEffectAt = now;
    if (cinematic.has(name)) this.stopEffects();
    else if (this.activeEffects.size >= 2) {
      const first = [...this.activeEffects].find(item => !item.cinematic);
      if (!first) return;
      first.pause(); this.activeEffects.delete(first);
    }
    const item = new Audio(mediaUrl(name));
    item.cinematic = cinematic.has(name); item.guard = name === 'guard';
    item.playbackRate = 1; // Keep the sound timbre stable when visuals accelerate.
    item.volume = this.effectsVolume * (item.cinematic ? .82 : item.guard ? .18 : .42);
    this.activeEffects.add(item);
    const stop = () => { item.pause(); this.activeEffects.delete(item); signal?.removeEventListener('abort', stop); };
    signal?.addEventListener('abort', stop, { once: true });
    item.addEventListener('ended', stop, { once: true });
    item.play().catch(stop);
  }
  label() { return !this.unlocked ? '开启音乐' : this.enabled ? '音乐开' : '音乐关'; }
  controls() { return `<div class="audio-controls"><button type="button" id="musicToggle" aria-label="切换音乐">♪ ${this.label()}</button><button type="button" id="effectsToggle">音效${this.effectsEnabled ? '开' : '关'}</button><label>音量 <input id="musicVolume" type="range" min="0" max="100" value="${Math.round(this.volume * 100)}" aria-label="音乐音量"></label><label>音效 <input id="effectsVolume" type="range" min="0" max="100" value="${Math.round(this.effectsVolume*100)}" aria-label="音效音量"></label></div>`; }
  bind() {
    document.querySelector('#effectsVolume')?.addEventListener('input', event=>{this.effectsVolume=Number(event.target.value)/100;this.applyVolume();this.save();});
    document.querySelector('#effectsToggle')?.addEventListener('click', () => { this.effectsEnabled = !this.effectsEnabled; if (!this.effectsEnabled) this.stopEffects(); this.save(); document.querySelector('#effectsToggle').textContent = '音效' + (this.effectsEnabled ? '开' : '关'); });
    document.querySelector('#musicToggle')?.addEventListener('click', () => {
      this.toggle();
      document.querySelector('#musicToggle').textContent = `♪ ${this.label()}`;
      if (this.enabled) this.effect('menu', true);
    });
    document.querySelector('#musicVolume')?.addEventListener('input', event => this.setVolume(event.target.value / 100));
  }
  inspect() {
    return { scene: this.sceneName, unlocked: this.unlocked, enabled: this.enabled, volume: this.volume,
      tracks: Object.fromEntries(Object.entries(this.music).map(([name, item]) => [name, { paused: item.paused, time: item.currentTime, readyState: item.readyState }])) };
  }
}
