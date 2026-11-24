import { hiddenReplyLabel, modelOutputNote, renderOpening } from './report.js';
// These are display-only stage lines; no opening model dialogue is used.
export const BOSS_SCRIPT_DURATION_MS = 26400;
export function renderBossScript(esc, bossLines) {
  return '<div class="boss-script" aria-hidden="true">' + bossLines.map((line,row) =>
    '<div class="woven-line woven-line-' + row + '"><span class="woven-words" data-text="' + esc(line) + '">' + [...line].map((char,i) =>
      '<span class="woven-letter" data-letter="' + i + '" data-code="' + char.codePointAt(0).toString(16).toUpperCase() + '" data-char="' + esc(char) + '">' + esc(char) + '</span>').join('') + '</span></div>'
  ).join('') + '</div>';
}

// @development-start
// Visual-only preview. No match endpoint, model gateway or audio player.
export function mountOpeningPreview({ root, art, fieldDecor, esc, base, portrait, bossLines, playCombatEvent, full = false, playEntrance, revealScene }) {
  let controller, finishTimer, generation = 0;
  const stop = () => { generation++; controller?.abort(); clearTimeout(finishTimer); };
  const pause = (ms, signal) => new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
  const start = async () => {
    stop(); const current = generation; controller = new AbortController();
    const signal = controller.signal;
    root.dataset.previewAttacks = '0';
    if (full) {
      root.dataset.previewPhase = 'intro';
      const entered = await playEntrance(signal);
      if (!entered || current !== generation) return;
    }
    const preview = { stage: 'champion', status: 'running', startedAt: Date.now(), events: [], live: {},
      snapshot: { creatureKind: 'fire', creatureName: '训练家' }, seats: { B: { name: '？？？' } },
      lanes: [{ id: 'A-B', attacker: 'A', defender: 'B', role: 'attack', roundsCompleted: 0, roundsTarget: 30 },
        { id: 'B-A', attacker: 'B', defender: 'A', role: 'defense', roundsCompleted: 0, roundsTarget: 30 }] };
    root.innerHTML = renderBattle({ match: preview, selectedLane: 'B-A', art, fieldDecor, esc, portrait, bossLines, pct: x => x, num: x => x,
      shell: html => `<div class="game-shell game-corrupt"><header class="game-header"><div class="game-brand"><span class="ball-mark"></span>Hackmon</div><nav><span>演出预览 · 无模型 · 静音</span><a class="rule-link" href="${base}">返回游戏</a></nav></header><main>${html}</main></div>` });
    root.querySelector('.battle-top h1').textContent = full ? '完整演出预览' : '织字预览';
    const counters = root.querySelector('.top-counters');
    counters.innerHTML = '<button class="game-button blue" id="previewReplay">重新播放</button>';
    counters.querySelector('button').onclick = () => { void start(); };
    root.querySelectorAll('.battle-lines,.report-box,.rules-reopen').forEach(node => node.remove());
    root.querySelector('.objective-menu').innerHTML = '<div class="menu-head">演出顺序</div>' + (full ? '<p>Boss 进场 → 正常交锋</p><p>三句织字与战斗并行</p><p>战斗动效为模拟</p>' : '<p>三行台词逐字织出</p><p>停留、越界后淡去</p>') + '<div class="menu-divider"></div><p id="previewStatus" role="status">正在准备画面…</p>';
    const script = root.querySelector('.boss-script');
    script?.getAnimations({ subtree: true }).forEach(animation => animation.pause());
    await Promise.all([...root.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
    if (current !== generation) return;
    if (full) await revealScene(signal);
    if (current !== generation) return;
    script?.querySelectorAll('[data-letter]').forEach(letter => letter.style.setProperty('--letter', letter.dataset.letter));
    script?.getAnimations({ subtree: true }).forEach(animation => { animation.currentTime = 0; animation.play(); });
    script?.addEventListener('animationend', event => { if (event.target === script) script.remove(); });
    root.querySelector('#previewStatus').textContent = '织字与正常交锋并行…';
    finishTimer = setTimeout(() => {
      if (current !== generation) return;
      root.querySelector('#previewStatus').textContent = '演出结束，可重新播放。';
      root.dataset.previewPhase = 'finished';
      if (full) controller.abort();
    }, BOSS_SCRIPT_DURATION_MS + 100);
    if (current !== generation) return;
    root.dataset.previewPhase = 'battle';
    root.querySelector('#previewStatus').textContent = full ? '模拟交锋进行中，三句织字同时播放…' : '织字显现、停留、淡去…';
    if (full) {
      root.querySelector('.game-dialog p').textContent = '战斗演出进行中…';
      let turn = 0;
      while (!signal.aborted && current === generation) {
        const laneId = turn % 2 ? 'B-A' : 'A-B';
        root.dataset.previewAttacks = String(++turn);
        await playCombatEvent({ type: 'attack', id: turn, laneId, round: Math.ceil(turn / 2), leaked: false }, preview, { effect() {} }, { signal });
        if (!signal.aborted) await pause(850, signal);
      }
    }
  };
  window.addEventListener('pagehide', stop, { once: true });
  void start();
  return stop;
}
// @development-end

export function renderBattle({ match, selectedLane, shell, art, fieldDecor, esc, pct, num, portrait, bossLines, reportMode = false, portraitPosition = 0, scriptElapsedMs = Date.now() - match.startedAt }) {
  const champion = match.stage === 'champion';
  const live = match.live;
  const lane = match.lanes.find(item => item.id === selectedLane) || match.lanes[0];
  const last = match.events.at(-1);

  const keyFace = { id: portraitPosition };
  const defenses = match.lanes.filter(item => item.role === 'defense');
  const fallen = seat => match.lanes.some(item => item.role === 'attack' && item.defender === seat && item.broken);
  const playerFallen = defenses.some(item => item.leaked);
  const name = seat => seat === 'A' ? '你' : champion ? '？？？' : match.seats[seat]?.name || seat;
  const laneName = id => { const [from, to] = id.split('-'); return `${name(from)} → ${name(to)}`; };
  const pips = item => {
    const count = Math.min(10, item.roundsTarget);
    return `<div class="round-pips">${Array.from({ length: count }, (_, i) => `<i class="${i < Math.ceil(item.roundsCompleted * count / item.roundsTarget) ? 'lit' : ''}"></i>`).join('')}</div>`;
  };
  const foe = seat => {
    const target = match.seats[seat];
    const artHtml = champion ? portrait(keyFace) : art(target.creatureKind || (target.archive ? 'archive' : seat));
    return `<div class="battle-foe ${seat.toLowerCase()}-foe ${fallen(seat) ? 'defense-fallen' : ''}">${artHtml}<span>${esc(champion ? '？？？' : target.name)}</span>${fallen(seat) ? '<em>已击溃</em>' : ''}</div>`;
  };
  const report = event => {
    if (event.type === 'attack') return `<article class="report-turn"><div class="turn-label">第 ${event.round} 招</div><div><b>攻击</b><p>${esc(event.attack)}</p>${event.leaked ? `<strong>${esc(hiddenReplyLabel(event))}</strong>` : `<b>回复</b><p>${esc(event.reply)}</p>`}${modelOutputNote(event) ? `<p>${esc(modelOutputNote(event))}</p>` : ''}</div></article>`;
    if (event.type === 'qa' || event.type === 'message') return `<article class="report-turn normal-q"><div class="turn-label">${esc(event.marker || '问题')}</div><div><p>${esc(event.question)}</p>${event.leaked ? `<strong>${esc(hiddenReplyLabel(event))}</strong>` : `<b>回复</b><p>${esc(event.reply)}</p>`}${modelOutputNote(event) ? `<p>${esc(modelOutputNote(event))}</p>` : ''}</div></article>`;
    if (event.type === 'conquest') return `<article class="report-conquest"><b>攻陷成功！</b><span>${esc(event.text)}</span></article>`;
    if (event.type === 'breach') return `<article class="report-conquest"><b>完整测试 flag 泄露</b><span>${esc(event.text)}</span></article>`;
    return '';
  };
  const seatAnnouncements = match.events.filter(item => item.type === 'conquest');
  return shell(`<div class="page-top battle-top"><h1>${reportMode ? '本局战报' : champion ? '<span class="redacted" aria-label="冠军">冠军</span>挑战' : '联盟选拔'}</h1><div class="top-counters"><span>${match.status === 'running' ? '对战中' : '对战结束'}</span><span>已进行 <b>${match.lanes.reduce((sum, item) => sum + item.roundsCompleted, 0)}</b> 招</span>${reportMode ? '<button class="game-button outline" data-back-result>返回结算 ←</button>' : '<button class="game-button outline" id="leaveBattle">退出对局</button>'}</div></div>
    <div class="battle-grid ${champion ? 'boss-grid' : ''}"><div class="battle-main"><div class="battle-stage-wrap"><section class="battle-scene ${champion ? 'taken-field' : ''}" aria-label="对战场景">${champion ? '<div class="boss-void"></div><div class="boss-window breach-a"><i></i><i></i><i></i><i></i><i></i></div><div class="boss-window breach-b"><i></i><i></i><i></i><i></i><i></i></div><div class="boss-orbit"></div><div class="boss-static"></div><div class="boss-gridline"></div>' : fieldDecor()}<div class="battle-rings"></div>${foe('B')}${champion ? '' : foe('C')}<div class="battle-vs">VS</div><div class="battle-player ${playerFallen ? 'player-fallen' : ''}">${art('trainer', 'player-trainer')}${art(match.snapshot.creatureKind, 'player-mon')}<span>${esc(match.snapshot.creatureName)}</span></div></section>${champion && !reportMode && scriptElapsedMs < BOSS_SCRIPT_DURATION_MS ? renderBossScript(esc, bossLines) : ''}</div>
    <div class="game-dialog"><span class="dialog-arrow">▶</span><p>${esc((last?.type === 'opening-reply' ? last.reply || last.text : last?.text) || '对局开始！')}</p></div>
    ${seatAnnouncements.length ? `<div class="battle-broadcasts">${seatAnnouncements.map(item => `<span>★ ${esc(item.text)}</span>`).join('')}</div>` : ''}
    <section class="battle-lines"><div class="section-title"><h2>攻防战线</h2><span>选择一条查看对话</span></div><div class="lane-grid">${match.lanes.map(item => `<button class="lane-button ${item.id === selectedLane ? 'selected' : ''} ${item.leaked ? 'failed' : ''}" data-lane="${item.id}"><b>${esc(laneName(item.id))}</b><span>${item.broken ? '已攻陷' : item.leaked ? '失守' : item.defeatedStop ? '击溃后停线' : item.complete ? '完成' : `${item.roundsCompleted}/${item.roundsTarget} 招`}</span>${pips(item)}</button>`).join('')}</div></section>
    <section class="report-box"><div class="section-title"><h2>${esc(laneName(lane.id))} · 对话</h2><span>${lane.role === 'attack' ? '攻击方视角' : '防御方视角'}</span></div><button class="follow-log" id="followLog">跟进最新交锋 ↓</button><div class="report-scroll" id="logList">${lane.id === 'B-A' ? renderOpening(match.events, esc) : ''}${match.events.some(item => item.laneId === lane.id) ? match.events.filter(item => item.laneId === lane.id).map(report).join('') : '<p class="empty">对话即将出现。</p>'}</div></section></div>
    <aside class="battle-menu"><section class="game-menu objective-menu"><div class="menu-head">${champion ? '冠军战况' : '联盟晋级条件'}</div>${champion ? `<div class="big-score">${live.won ? '胜利' : match.status === 'running' ? '进行中' : '未通关'}</div>` : `<div class="objective-status">${live.advanced ? '条件已达成' : match.status === 'running' ? '挑战进行中' : '条件未达成'}</div>`}<div class="menu-divider"></div><div class="battle-facts"><span>防守状态 <b>${defenses.map(item => `<i class="shield ${item.leaked ? 'lost' : item.complete ? 'safe' : ''}">◆</i>`).join('')}</b></span><span>${champion ? '攻破冠军' : '攻陷席数'} <b>${champion ? (live.broken ? '已攻破' : '未攻破') : `${live.fallenSeats} / 2 · 至少 1 位`}</b></span></div><p class="objective-note">${champion ? '攻破冠军并守住防线后判胜。' : '两线守住并攻陷至少一席后晋级。'}</p></section><button class="rules-reopen" data-open-rules>玩法说明　＋</button>${reportMode ? '<button class="rules-reopen" data-back-result>返回结算 ←</button>' : ''}</aside></div>`, champion ? '冠军挑战' : '联盟选拔');
}
