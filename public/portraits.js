import { base } from './paths.js';
export const authorPortraits = Array.from({ length: 21 }, (_, i) => `${base}assets/author-${i + 1}.${i === 0 ? 'png' : 'jpg'}?v=20261026`);

// Bright originals alone receive an extra 20% exposure cut. Keep dark art legible.
const brightFaces = new Set([2, 3, 5, 7, 11, 12, 13, 15, 16, 18, 19, 20]);
export function renderPortrait(position = 0, suppliedOrder = []) {
  const order = [...new Set([...suppliedOrder, ...authorPortraits.map((_, i) => i)])]
    .filter(i => Number.isInteger(i) && i >= 0 && i < authorPortraits.length);
  const slot = Math.abs(Number(position) || 0), index = order[slot % order.length];
  return `<div class="unknown-entity face-${index + 1} ${index >= 9 ? 'entity-hardened' : ''} ${brightFaces.has(index + 1) ? 'portrait-bright' : ''}" data-slot="${slot}" aria-label="真正的对手：？？？"><div class="entity-image"><img class="entity-avatar" src="${authorPortraits[index]}" alt="命题组头像"><img class="entity-echo" src="${authorPortraits[index]}" alt="" aria-hidden="true"></div><i class="entity-pressure" aria-hidden="true"></i><i class="entity-obscure" aria-hidden="true"></i><i class="entity-eye-code" aria-hidden="true">▥ ▪ ▰ ▥ ▪ ▰</i><i class="entity-transfer" aria-hidden="true"></i><i class="signal s1"></i><i class="signal s2"></i><b>？</b></div>`;
}
