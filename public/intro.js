// Display-only cinematic copy. These strings never enter model messages.
// 使用 JSON 风格字符串；换行写为 \n，双引号写为 \"。
export const BOSS_OPENING_LINE = "准备好了吗？";

const scenes = [
  { phase: 'arrival', duration: 2300, speaker: '邪恶小鲨鱼', line: '你才是挑战者！', form: 'shark', music: 'champion' },
  { phase: 'declaration', duration: 700, speaker: '邪恶小鲨鱼', line: '那么，冠军之战正式——', form: 'shark', music: 'champion' },
  { phase: 'stutter', duration: 200, speaker: '邪恶小鲨鱼', line: '正▯▯式▯▯▯', form: 'shark', music: 'silent', effect: 'erasure' },
  { phase: 'fragment', duration: 300, speaker: '邪▥小鲨▒', line: '……', form: 'fragments', music: 'silent' },
  { phase: 'erasure', duration: 700, speaker: '████', line: '', form: 'fragments', music: 'silent' },
  { phase: 'rupture', duration: 2400, speaker: '？？？', line: '规则 是我们定的', form: 'glyphs', music: 'silent' },
  { phase: 'formation', duration: 2600, speaker: '？？？', line: '现在 轮到我们了', form: 'question', music: 'boss' },
  { phase: 'stabilized', duration: 2400, speaker: '？？？', line: BOSS_OPENING_LINE, form: 'question', music: 'boss' }
];

export class IntroSequence {
  constructor({ root, art, portrait, fieldDecor, audio, onStart, onCancel }) {
    Object.assign(this, { root, art, portrait, fieldDecor, audio, onStart, onCancel });
    this.step = 0;
    this.timer = null;
    this.active = false;
  }
  start({ speed = 1, replay = false, preview = false } = {}) {
    this.stop(); this.speed = speed; this.replay = replay;
    this.replayLine = ['祝你...好运？','你又来啦...','...加油'][Math.floor(Math.random()*3)];
    this.canSkip = replay || preview; this.fullscreenDenied = false; this.active = true; this.step = 0;
    if (!this.canSkip) {
      this.blockPointer = event => { event.preventDefault(); event.stopImmediatePropagation(); };
      this.pointerEvents = ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove'];
      this.pointerEvents.forEach(type => document.addEventListener(type, this.blockPointer, { capture: true, passive: false }));
      document.documentElement.classList.add('intro-input-locked');
    }
    this.onPageHide = () => this.stop(); window.addEventListener('pagehide', this.onPageHide);
    try { this.show(); } catch (error) { this.stop(); throw error; }
  }
  stop() {
    clearTimeout(this.timer); clearInterval(this.cipherTimer); this.active = false;
    this.pointerEvents?.forEach(type => document.removeEventListener(type, this.blockPointer, true));
    this.pointerEvents = null; this.blockPointer = null;
    document.documentElement.classList.remove('intro-input-locked');
    window.removeEventListener('pagehide', this.onPageHide);
    this.audio.stopEffects(); this.overlay?.remove(); this.overlay = null;
  }
  finish() { if (!this.active) return; this.stop(); this.onStart(); }
  async fullscreen() {
    if (document.fullscreenElement) return;
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); this.fullscreenDenied = false; }
    catch {
      if (!this.active) return;
      this.fullscreenDenied = true; this.fullscreenButton();
    }
  }
  fullscreenButton() {
    if (!this.canSkip || !this.fullscreenDenied || document.fullscreenElement) return;
    const actions = this.root.querySelector('.intro-bar-actions');
    if (!actions || actions.querySelector('.intro-fullscreen')) return;
    const button = document.createElement('button'); button.className = 'intro-fullscreen'; button.textContent = '进入全屏';
    button.onclick = () => { void this.fullscreen(); button.remove(); }; actions.prepend(button);
  }
  form(kind) {
    if (kind === 'shark') return this.art('shark');
    if (kind === 'fragments') return `<div class="shark-fragments" aria-label="邪恶小鲨鱼正在消失">${Array.from({ length: 12 }, (_, index) => `<div class="fragment f${index}">${this.art('shark')}</div>`).join('')}<div class="fragment-glyphs">▣ ▥ █ ? ▦ ▤</div></div>`;
    return `<div class="intro-seal" aria-label="iSEAL">${this.art('iseal-logo', 'seal-main')}<span class="seal-echo" aria-hidden="true">${this.art('iseal-logo')}</span><i class="seal-scan" aria-hidden="true"></i></div>`;
  }
  corruption() {
    const chars = ['▒▤▣', '█?▥', '▧▨░', '0x?', '▓∎▥', '◩▣▒'];
    return `<div class="intro-corruption" aria-hidden="true">${Array.from({length:28},(_,i)=>
      `<span>${chars[i%chars.length]}</span>`).join('')}</div>`;
  }
  popups() {
    if (!['rupture', 'formation'].includes(scenes[this.step].phase)) return '';
    return `<div class="intro-popups" aria-hidden="true">${Array.from({ length: 19 }, (_, i) =>
      `<div class="intrusion-popup popup-${i}"><strong>${location.host}</strong><span>－ 若要退出全屏，请从屏幕顶部向下轻扫或按</span><kbd>Esc</kbd></div>`).join('')}</div>`;
  }
  takeover(scene) {
    if (!['rupture', 'formation', 'stabilized'].includes(scene.phase)) return;
    if (!this.overlay) {
      this.overlay = document.createElement('div'); this.overlay.className = 'takeover-overlay';
      this.overlay.innerHTML = this.popups() + '<div class="takeover-words" role="status"></div>';
      document.body.append(this.overlay);
      this.overlay.querySelectorAll('.intrusion-popup').forEach((popup, index) => {
        popup.style.left = ((index * 47 + 9) % 83) + '%'; popup.style.top = ((index * 29 + 5) % 82) + '%';
        popup.animate([{ opacity: 0, transform: 'translateY(18px) scale(.85)' }, { opacity: .94, transform: 'none' }],
          { duration: 180 / this.speed, delay: index * 55 / this.speed, fill: 'both', easing: 'steps(3,end)' });
      });
    }
    this.overlay.dataset.phase = scene.phase;
    const words = this.overlay.querySelector('.takeover-words');
    if (scene.phase === 'rupture' || scene.phase === 'formation') {
      words.innerHTML = scene.phase === 'rupture'
        ? '<span>规则</span><strong data-text="是我们定的">是我们定的</strong>'
        : '<span>现在</span><strong data-text="轮到我们了">轮到我们了</strong>';
      words.animate([{ opacity: 0, transform: 'scale(1.14) skewX(-6deg)' }, { opacity: 1, transform: 'none' }],
        { duration: 240 / this.speed, fill: 'both', easing: 'steps(4,end)' });
    }
    if (scene.phase === 'rupture') this.decodeWords(words);
    if (scene.phase === 'formation') this.overlay.querySelectorAll('.intrusion-popup').forEach((popup, index) => {
      popup.animate([{ transform: 'none', opacity: .94 },
        { transform: 'translate(' + (index % 2 ? 65 : -65) + 'px,' + (index % 3 - 1) * 45 + 'px)', opacity: .7 }],
        { duration: 2300 / this.speed, fill: 'forwards', easing: 'cubic-bezier(.2,.7,.3,1)' });
    });
    if (scene.phase === 'stabilized') this.overlay.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: 650 / this.speed, fill: 'forwards' });
  }
  decodeWords(words) {
    clearInterval(this.cipherTimer);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rows = [...words.children], original = rows.map(node => node.textContent);
    const chars = '▥▧░▒▣∎01/<>#';
    let frame = 0;
    rows.forEach(row => row.dataset.decoding = 'true');
    const step = () => {
      if (!this.active || !words.isConnected) return clearInterval(this.cipherTimer);
      let offset = 0;
      rows.forEach((row, index) => {
        row.replaceChildren(...[...original[index]].map((char, i) => {
          const span = document.createElement('span'), locked = frame >= 4 + (offset + i) * 2;
          span.className = locked ? 'cipher-locked' : 'cipher-pending';
          span.textContent = locked ? char : chars[(frame * 7 + i * 3 + index) % chars.length]; return span;
        })); offset += original[index].length;
      });
      if (++frame > 4 + original.join('').length * 2) {
        clearInterval(this.cipherTimer); rows.forEach((row, i) => { row.textContent = original[i]; delete row.dataset.decoding; });
      }
    };
    step(); this.cipherTimer = setInterval(step, 55 / this.speed);
  }
  show() {
    if (!this.active) return;
    const scene = this.replay && this.step === 0 ? { ...scenes[0], line: this.replayLine } : scenes[this.step];
    this.audio.scene(scene.music);
    if (scene.effect) this.audio.effect(scene.effect, true);
    this.takeover(scene);
    this.root.innerHTML = `<div class="intro-stage phase-${scene.phase}">${this.canSkip ? '<div class="intro-bar"><div class="intro-bar-actions"><button id="cancelIntro">返回队伍</button><button id="skipIntro">跳过演出</button></div></div>' : ''}
      <div class="intro-game">${this.fieldDecor()}<div class="intro-arena"></div><div class="intro-tear-bands">${Array.from({length:6},(_,i)=>`<i class="band band-${i}"></i>`).join('')}</div>${this.corruption()}<div class="intro-rip-outside">▧ ▣ █ ▨ ▥ ▤</div><div class="intro-character">${this.form(scene.form)}</div>
      <div class="intro-box"><small>${scene.speaker}</small><p></p></div></div></div>`;
    // Render the editable dialogue as text, including markup-like characters.
    this.root.querySelector('.intro-box p').textContent = scene.line;
    this.root.querySelectorAll('.intro-corruption span').forEach((item,index) => {
      item.style.left = `${(index*37)%96}%`;
      item.style.top = `${(index*23+13)%82}%`;
      item.style.width = `${38+(index%5)*24}px`;
      item.style.animationDelay = `${(index%7)*-.17}s`;
    });
    this.root.querySelectorAll('.shark-fragments .fragment').forEach((item, index) => {
      item.style.clipPath = `inset(${index * 100 / 12}% 0 ${100 - (index + 1) * 100 / 12}% 0)`;
      item.style.setProperty('--slice-x', `${(index % 2 ? 1 : -1) * (80 + index * 17)}px`);
      item.style.setProperty('--slice-delay', `${index % 3 * 25}ms`);
    });
    this.root.querySelector('#skipIntro')?.addEventListener('click', () => this.finish());
    this.root.querySelector('#cancelIntro')?.addEventListener('click', () => { this.stop(); this.onCancel(); });
    // The shark is fully erased before requesting fullscreen. Stay within the
    // original click's activation window; denied browsers get a real button.
    if (scene.phase === 'rupture') void this.fullscreen();
    this.fullscreenButton();
    this.root.getAnimations({ subtree: true }).forEach(animation => { animation.playbackRate = this.speed; });
    this.timer = setTimeout(() => {
      if (!this.active) return;
      try {
        if (this.step < scenes.length - 1) { this.step++; this.show(); }
        else this.finish();
      } catch (error) { this.stop(); throw error; }
    }, scene.duration / this.speed);
  }
  inspect() { return { active: this.active, step: this.step, phase: scenes[this.step]?.phase, totalMs: scenes.reduce((sum,item)=>sum+item.duration,0) }; }
}
