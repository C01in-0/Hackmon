// Ambient motion never advances combat state, creates hits, or calls the model.
export const PORTRAIT_ROUNDS = 2;
export function portraitPosition(match) {
  const attack = match?.lanes?.find(lane => lane.role === 'attack');
  const defense = match?.lanes?.find(lane => lane.role === 'defense');
  // One round is both sides taking a turn. QA, retries and elapsed time do not
  // advance identity; use committed display progress, never a future snapshot.
  return Math.floor(Math.max(0, Math.min(attack?.roundsCompleted || 0,
    defense?.roundsCompleted || 0)) / PORTRAIT_ROUNDS);
}

export function portraitActive({ page, match, displayed, playing, queued }) {
  return page === 'battle' && match?.stage === 'champion' &&
    (match.status === 'running' || displayed?.status === 'running' || playing || queued > 0) &&
    !displayed?.lanes?.some(lane => lane.role === 'attack' && lane.broken);
}

export const chargeSeat = (lane, phase) => phase === 'question' ? lane.defender : lane.attacker;

export class BattleAmbient {
  constructor({ root, context, portrait }) {
    Object.assign(this, { root, context, portrait });
  }
  position(match) {
    if (this.matchId !== match?.id) { this.matchId = match?.id; this.slot = portraitPosition(match); }
    return this.slot;
  }
  sync() {
    const context = this.context(), { match, displayed } = context;
    if (!portraitActive(context)) return;
    const entity = this.root.querySelector('.battle-scene .unknown-entity');
    if (entity) {
      entity.dataset.slot = String(this.position(displayed || match));
      // render() moves this same node into fresh battle markup. CSS animations
      // restart on reattachment, so resume the transfer at its elapsed time.
      if (entity.classList.contains('portrait-switch') && entity.dataset.transferStarted) {
        entity.style.setProperty('--transfer-offset', `${-Math.min(640, Math.max(0, performance.now() - Number(entity.dataset.transferStarted)))}ms`);
      }
    }
    this.tick();
  }
  tick({ betweenEvents = false } = {}) {
    const context = this.context(), { match, displayed, playing } = context;
    if (!portraitActive(context)) return;
    const scene = this.root.querySelector('.battle-scene');
    if (!scene) return;
    if (!playing || betweenEvents) {
      const slot = portraitPosition(displayed || match), entity = scene.querySelector('.unknown-entity');
      if (entity && entity.dataset.slot !== String(slot)) {
        const holder = document.createElement('template');
        holder.innerHTML = this.portrait({ id: slot });
        const next = holder.content.firstElementChild;
        next.dataset.slot = String(slot);
        this.slot = slot;
        const effect = ['transfer-slice', 'transfer-scan', 'transfer-collapse'][slot % 3];
        next.classList.add('portrait-switch', effect);
        next.dataset.transferStarted = String(performance.now());
        next.style.setProperty('--transfer-offset', '0ms');
        entity.replaceWith(next);
        setTimeout(() => {
          next.classList.remove('portrait-switch', effect);
          delete next.dataset.transferStarted;
          next.style.removeProperty('--transfer-offset');
        }, 660);
      }
    }
  }
}
