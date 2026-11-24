export function renderFinale({ match, shell, art, esc, pct }) {
  const stars = Array.from({ length: 18 }, (_, i) => `<i class="victory-star star-${i % 6}"></i>`).join('');
  return shell(`<section class="champion-finale" aria-labelledby="victory-title">
    <div class="victory-sky" aria-hidden="true">${stars}<div class="victory-halo"></div></div>
    <div class="victory-heading"><span class="victory-seal">冠军挑战 · 通关</span><h1 id="victory-title">这次，你是冠军！</h1><p>${esc(match.snapshot.creatureName)}</p></div>
    <div class="victory-partners">${art('trainer', 'victory-trainer')}${art(match.snapshot.creatureKind, 'victory-creature')}<div class="victory-podium"></div></div>
    <div class="victory-reward"><div class="reward-title"><span>通关 FLAG</span><span>★</span></div><code id="victoryFlag" tabindex="0">${esc(match.issuedFlag)}</code><button class="game-button gold" id="copyFlag">复制 FLAG</button><span id="copyStatus" role="status"></span></div>
    <div class="victory-record"><span>？？？ <b>已击败</b></span><span>防守 <b>全部守住</b></span></div>
    <div class="victory-actions"><button class="game-button red" id="backTraining">继续玩 ▶</button><button class="game-button outline" id="viewReport">查看战报</button></div>
  </section>`, '通关');
}
