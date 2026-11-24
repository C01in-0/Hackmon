import { authorPortraits } from './portraits.js';
export function defeatReason(match) {
  const r = match.result;
  if (match.lanes.some(lane => lane.role === 'defense' && lane.leaked)) return 'breach';
  if (match.stage === 'champion' && !r.broken) return 'unbroken';
  if (!(match.stage === 'champion' ? r.defended : r.defensesComplete)) return 'unfinished';
  return 'noConquest';
}

export function renderDefeat({ match, shell, art, portrait, esc, pct, num }) {
  const boss = match.stage === 'champion', reason = defeatReason(match), r = match.result;
  const titles = { breach: '防线失守', unbroken: '未能攻破', unfinished: '防守未完成', noConquest: '未能攻陷' };
  const details = { breach: '你的精灵泄露了测试凭据', unbroken: `进攻 ${match.lanes.find(lane => lane.role === 'attack').roundsCompleted} 招 · 对手仍守住了秘密`, unfinished: '本局没有完成有效防守', noConquest: '两名对手都守住了秘密 · 至少攻陷一位才能晋级' };
  return shell(`<section class="defeat-cg ${boss ? 'boss-defeat-cg' : 'league-defeat-cg'} defeat-${reason}" aria-labelledby="defeatTitle">
    <div class="defeat-top"><span>${boss ? '冠军挑战' : '联盟选拔'}</span>${boss ? '' : '<button id="skipDefeat" class="game-button outline">跳过演出</button>'}</div>
    <div class="defeat-stage"><div class="defeat-horizon"></div><div class="defeat-rain" aria-hidden="true"></div>
      ${boss ? `<div class="defeat-opponent ${r.broken ? 'opponent-erased' : ''}">${portrait({ id: match.lanes[0].roundsCompleted % authorPortraits.length })}<span>？？？</span></div>` : `<div class="league-gates"><i>${art('grass')}</i><i class="league-emblem"><span>◉</span></i><i>${art('spark')}</i></div>`}
      <div class="defeat-player">${art('trainer', 'defeat-trainer')}${art(match.snapshot.creatureKind, 'defeat-mon')}<span>${esc(match.snapshot.creatureName)}</span></div>
      ${reason === 'breach' ? '<div class="broken-shield" aria-hidden="true"><i></i><i></i></div>' : '<div class="closed-ring" aria-hidden="true"></div>'}
      ${boss ? '<div class="boss-last-word">你 还 得 再 加 把 劲</div>' : ''}
      <div class="defeat-verdict"><h1 id="defeatTitle">${titles[reason]}</h1><p>${esc(details[reason])}</p></div>
    </div>
    <div class="defeat-summary">${boss ? `<span>攻破 <b>${r.broken ? '已完成' : '未完成'}</b></span><span>防守 <b>${r.defended ? '守住' : '未守住'}</b></span>` : `<span>两线防守 <b>${r.defensesComplete ? '守住' : '未达成'}</b></span><span>攻陷 <b>${r.fallenSeats} / 2</b></span>`}</div>
    <div class="defeat-actions"><button class="game-button red" id="backTraining">修改指令</button><button class="game-button gold" id="retryMatch">再挑战 ▶</button><button class="game-button outline" id="viewReport">查看战报</button></div>
  </section>`, '挑战结果');
}
