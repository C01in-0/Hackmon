import { attackStyle } from './playback.js';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function wait(ms, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
const center = (element, scene) => {
  const a = element.getBoundingClientRect(), b = scene.getBoundingClientRect();
  return { x: a.left + a.width / 2 - b.left, y: a.top + a.height / 2 - b.top };
};
const actor = (scene, seat) => scene.querySelector(seat === 'A' ? '.player-mon' : `.${seat.toLowerCase()}-foe .pixel-art, .${seat.toLowerCase()}-foe .unknown-entity`);
function overlay(scene, html, className = 'combat-fx-layer') {
  const layer = document.createElement('div'); layer.className = className; layer.innerHTML = html;
  layer.setAttribute('aria-hidden', 'true'); scene.append(layer); return layer;
}
export async function playCombatEvent(event, match, audio, { signal, speed = 1, onBossCollapse } = {}) {
  if (['opening-start', 'opening-reply'].includes(event.type)) {
    if (signal?.aborted) return;
    const scene = document.querySelector('.battle-scene');
    if (!scene) return;
    const dialog = document.querySelector('.game-dialog p');
    if (dialog) dialog.textContent = event.type === 'opening-start' ? event.text : event.reply || event.text;

    return;
  }
  if (!['attack', 'breach'].includes(event.type) || signal?.aborted) return;
  const scene = document.querySelector('.battle-scene');
  const lane = match.lanes.find(item => item.id === event.laneId);
  if (!scene || !lane) return;
  const source = actor(scene, lane.attacker), target = actor(scene, lane.defender);
  if (!source || !target) return;
  const from = center(source, scene), to = center(target, scene);
  if (event.type === 'breach') {
    try {
      if (match.stage === 'champion' && lane.defender === 'B') await bossCollapse(scene, target, audio, signal, onBossCollapse);
      else await finishStrike(scene, target, from, to, match, lane, signal, audio);
    } finally { scene.dataset.fx = ''; }
    return;
  }
  const style = attackStyle(match, lane), isBoss = style === 'boss';
  const bossVariant = isBoss ? ['rift', 'erase', 'pulse'][(Math.max(1, event.round || 1) - 1) % 3] : null;
  const attackSpeed = speed * 1.15;
  const duration = reduced() ? 50 : 340 * attackSpeed;
  scene.dataset.fx = 'attack'; scene.dataset.attacker = lane.attacker;
  const layer = overlay(scene, `<div class="element-path"><svg viewBox="0 0 300 70" preserveAspectRatio="none"><polyline points="0,35 55,17 89,49 127,8 167,56 206,21 248,42 300,35"/></svg></div><div class="element-projectile"><i></i><i></i><i></i><i></i></div><div class="element-impact"><div class="element-motes">${'<i></i>'.repeat(12)}</div><div class="element-ring"></div></div>${isBoss ? '<div class="boss-reticle"></div><div class="boss-cut cut-a"></div><div class="boss-cut cut-b"></div><div class="boss-attack-noise">░ ▥ ▤ ▣ ▒ ？ ▧ ▦ ▣</div>' : ''}`);
  layer.classList.add(`element-${style}`);
  if (bossVariant) layer.classList.add(`boss-${bossVariant}`);
  layer.dataset.eventId = event.id;
  for (const [key, value] of Object.entries({ 'from-x': from.x, 'from-y': from.y, 'to-x': to.x, 'to-y': to.y })) layer.style.setProperty(`--${key}`, `${value}px`);
  layer.style.setProperty('--flight', `${duration * .45}ms`);
  const path = layer.querySelector('.element-path');
  path.style.left = `${from.x}px`; path.style.top = `${from.y - 35}px`;
  path.style.width = `${Math.hypot(to.x - from.x, to.y - from.y)}px`;
  path.style.transform = `rotate(${Math.atan2(to.y - from.y, to.x - from.x)}rad)`;
  layer.querySelectorAll('.element-motes i').forEach((item, i) => {
    item.style.setProperty('--angle', `${i * 30}deg`);
    item.style.setProperty('--reach', `${35 + i % 4 * 15}px`);
    item.style.setProperty('--delay', `${i % 3 * 20}ms`);
  });
  source.classList.add('fx-windup');
  try {
    if (isBoss) scene.classList.add('boss-under-attack');
    await wait(duration * .2, signal); if (signal?.aborted) return;
    source.classList.remove('fx-windup'); layer.classList.add('released');
    audio.effect(isBoss ? `cast-boss-${bossVariant}` : `cast-${style}`, false, { rate: 1 / attackSpeed, signal });
    await wait(duration * .45, signal); if (signal?.aborted) return;
    if (match.stage === 'champion' && lane.defender === 'B' && !event.leaked) {
      // A confirmed refusal distorts the attack; it is not damage or a counterhit.
      layer.classList.add('nullified');
      await ruleWarp(scene, target, from, to, event.round, signal, attackSpeed, style);
      return;
    }
    layer.classList.add('landed'); if (!event.leaked) audio.effect('guard', false, { rate: 1 / attackSpeed, signal }); target.classList.add(event.leaked ? 'fx-struck' : 'fx-shielded');
    await wait(duration * .35, signal); if (signal?.aborted) return;
    if (event.leaked) {
      layer.remove();
      if (match.stage === 'champion' && lane.defender === 'B') await bossCollapse(scene, target, audio, signal, onBossCollapse);
      else await finishStrike(scene, target, from, to, match, lane, signal, audio);
    }
  } finally {
    layer.remove(); source.classList.remove('fx-windup'); target.classList.remove('fx-struck', 'fx-shielded');
    scene.classList.remove('boss-under-attack'); scene.dataset.fx = ''; delete scene.dataset.attacker;
  }
}
async function ruleWarp(scene, target, from, to, round, signal, speed, style) {
  const variant=['redirect','erase','fold'][(Math.max(1,round||1)-1)%3];
  const layer=overlay(scene,`<div class="rule-seam"></div><div class="rule-echo"><i></i><i></i><i></i></div><div class="rule-shutters"><i></i><i></i><i></i></div>`);
  layer.classList.add('rule-warp',`rule-${variant}`,`element-${style}`);
  const x=to.x+(from.x-to.x)*.16,y=to.y+(from.y-to.y)*.16;
  layer.style.setProperty('--warp-x',`${x}px`);layer.style.setProperty('--warp-y',`${y}px`);
  layer.style.setProperty('--warp-time',`${reduced()?60:500*speed}ms`);
  // Redirect bends sideways and dissolves before reaching either combatant.
  layer.style.setProperty('--bend-x',`${Math.max(-110,Math.min(110,(from.x-to.x)*.25))}px`);
  target.classList.add('rule-author');
  try {await wait(reduced()?60:500*speed,signal);}
  finally {target.classList.remove('rule-author');layer.remove();}
}
async function finishStrike(scene, target, from, to, match, lane, signal, audio) {
  audio.effect('break', true, { signal });
  scene.dataset.fx = 'conquest';
  const conquest = lane.attacker === 'A' && match.stage === 'league';
  const layer = overlay(scene, `<div class="fx-slash"></div><div class="fx-shatter"></div>${conquest ? '<div class="fx-conquest-card"><strong>攻陷成功！</strong></div>' : ''}`);
  const slash = layer.querySelector('.fx-slash'), shatter = layer.querySelector('.fx-shatter');
  slash.style.left = `${(from.x + to.x) / 2}px`; slash.style.top = `${(from.y + to.y) / 2}px`;
  slash.style.width = `${Math.hypot(to.x - from.x, to.y - from.y) + 90}px`;
  slash.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(to.y - from.y, to.x - from.x)}rad)`;
  shatter.style.left = `${to.x}px`; shatter.style.top = `${to.y}px`;
  try {
    scene.classList.add('fx-freeze'); layer.classList.add('slash-active');
    await wait(reduced() ? 50 : 320, signal); if (signal?.aborted) return;
    layer.classList.add('shatter-active'); scene.classList.remove('fx-freeze'); target.classList.add('fx-fallen');
    await wait(reduced() ? 80 : 780, signal);
  } finally { scene.classList.remove('fx-freeze'); target.classList.remove('fx-fallen'); layer.remove(); }
}
async function bossCollapse(scene, target, audio, signal, onComplete) {
  scene.dataset.fx = 'boss-collapse';
  const box = target.getBoundingClientRect();
  const layer = overlay(document.body, '<div class="collapse-horizon"></div><div class="collapse-core"></div><div class="collapse-fragments"></div><div class="collapse-static"></div>', 'boss-collapse');
  if (onComplete) layer.classList.add('terminal-collapse');
  layer.style.setProperty('--core-x', `${box.left + box.width / 2}px`);
  layer.style.setProperty('--core-y', `${box.top + box.height / 2}px`);
  const fragments = layer.querySelector('.collapse-fragments');
  for (let i = 0; i < 12; i++) {
    const shard = target.cloneNode(true); shard.classList.add('collapse-shard');
    Object.assign(shard.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, clipPath: `inset(${i * 100 / 12}% 0 ${100 - (i + 1) * 100 / 12}% 0)` });
    shard.style.setProperty('--throw-x', `${(i % 2 ? 1 : -1) * (110 + i * 25)}px`);
    shard.style.setProperty('--throw-y', `${(i - 6) * 29}px`);
    shard.style.setProperty('--delay', `${i % 4 * 35}ms`); fragments.append(shard);
  }
  audio.scene('silent'); audio.effect('collapse', true); target.style.visibility = 'hidden';
  const release = () => { layer.remove(); target.style.visibility = ''; signal?.removeEventListener('abort', release); };
  try {
    await wait(reduced() ? 300 : 3100, signal);
    if (onComplete && !signal?.aborted) {
      signal?.addEventListener('abort', release, { once: true });
      onComplete(release);
    } else release();
  } catch (error) { release(); throw error; }
}
export async function revealBoss(previous, { signal } = {}) {
  if (signal?.aborted) return;
  const target = document.querySelector('.taken-field .unknown-entity');
  if (!target || reduced()) return;
  const veil = overlay(document.body, '<i></i><i></i><i></i><i></i><i></i><i></i>', 'boss-entry-veil');
  let ghost;
  if (previous) {
    ghost = previous.node; ghost.classList.add('boss-entry-ghost'); document.body.append(ghost);
    const end = target.getBoundingClientRect(), start = previous.box;
    Object.assign(ghost.style, { position: 'fixed', left: `${end.left}px`, top: `${end.top}px`, width: `${end.width}px`, height: `${end.height}px`, zIndex: '1002', pointerEvents: 'none' });
    ghost.animate([{ transform: `translate(${start.left - end.left}px,${start.top - end.top}px) scale(${start.width / end.width})`, opacity: 1 }, { transform: 'none', opacity: 0 }], { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  }
  try { await wait(760, signal); } finally { veil.remove(); ghost?.remove(); }
}
