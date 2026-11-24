import { appPath, base } from './paths.js';
import { renderScreeningFeedback } from './screening-feedback.js';
import { renderReport } from './report.js';
import { GameAudio } from './audio.js';
import { RulesPanel } from './rules-panel.js';
import { playCombatEvent, revealBoss } from './fx.js';
import { renderBattle, mountOpeningPreview } from './battle-view.js';
import { IntroSequence } from './intro.js';
import { commitEvent } from './playback.js';
import { renderFinale } from './finale.js';
import { renderPortrait } from './portraits.js';
import { BattleAmbient, chargeSeat } from './battle-ambient.js';
import { renderDefeat } from './defeat.js';
// @development-start
import { DeveloperPanel } from './developer-panel.js';
// @development-end

const sceneEpoch = Date.now();
const root = document.querySelector('#app');
const toast = document.querySelector('#toast');
const audio = new GameAudio();
// @development-start
window.__t1Audio = audio; // Read-only browser QA can inspect actual playback state.
// @development-end
const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const pct = value => `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`;
const num = value => Number(value || 0).toFixed(1).replace(/\.0$/, '');
const assets = { attack: 'fire', defense: 'water', trainer: 'trainer', shark: 'evil-little-shark', B: 'grass', C: 'spark', archive: 'grass' };
const art = (kind, className = '') => `<img class="pixel-art ${className}" src="${base}assets/${assets[kind] || kind}.png?v=20261026" alt="">`;
let reportData = null, eventStream = null, pinnedLane = false;
let state, match, page = 'training', selectedLane = 'A-B';
let draftAttack = '', draftDefense = '', archiveId = '';
let playerModelKey = ''; // Page memory only; excluded from drafts and browser storage.
function withModelKey(data) {
  if (!state?.modelKeyRequired) return data;
  if (!playerModelKey) throw new Error('请先填写硅基流动 API Key。');
  return { ...data, apiKey: playerModelKey };
}

function modelKeyField(id = 'playerModelKey') {
  return `<label for="${id}">硅基流动 API Key</label><input id="${id}" type="password" autocomplete="off" spellcheck="false" value="${esc(playerModelKey)}" placeholder="sk-…" class="model-key-input"><p class="model-key-help"><a href="https://cloud.siliconflow.cn/me/account/ak" target="_blank" rel="noopener noreferrer">获取 API Key ↗</a><br>本题全程调用免费模型<br>仅本页临时使用，刷新后需重新填写。</p>`;
}
let draftCreatureKind = 'fire', draftTestName = '';
let screenFeedbackOpen = false, screenBusy = false, serverClockOffset = 0;
let screenProgressPolling = false, screenProgressGeneration = 0;
const creatures = [
  { id: 'fire', label: '火团' }, { id: 'water', label: '水灵' },
  { id: 'grass', label: '苔团' }, { id: 'spark', label: '闪豆' }
];
let pollTimer, introTimer, introStep = -1, introStarted = false, introRequestId = null;
let fxQueue = [], fxPlaying = false, lastEventId = 0, pollBusy = false, resultScheduled = false;
let releaseBossCollapse = null;
let exitingMatch = false;
let startingLeague = false, presentationEvent = null, pausedMatchId = null;
let bossPresentation = null;
let displayedMatch = null, playbackGeneration = 0, effectController = null, resultTimer = null;
let pollFailures = 0, pollRetryAt = 0;
const ambient = new BattleAmbient({ root, portrait, context: () => ({ page, match, displayed: displayedMatch || match, playing: fxPlaying, queued: fxQueue.length }) });
// @development-start
window.__t1Playback = () => ({ page, fxPlaying, queued: fxQueue.length, resultScheduled, matchStatus: match?.status,
  displayedStatus: displayedMatch?.status, displayedEvent: displayedMatch?.events.at(-1)?.id,
  displayedLanes: displayedMatch?.lanes, effectEvent: presentationEvent?.id,
  effectRound: presentationEvent?.round, effectLane: presentationEvent?.laneId,
  lastEventId, pollBusy });
// @development-end
let entryRenderDeferred = false;
const rules = new RulesPanel(() => state, () => {
  void audio.unlock(); audio.effect('menu', true);
  if (entryRenderDeferred) { entryRenderDeferred = false; render(); }
});

async function api(path, method = 'GET', data) {
  const controller = new AbortController();
  const timeout = method === 'GET' ? setTimeout(() => controller.abort(), 8000) : null;
  try {
    const response = await fetch(appPath(path), { method, signal: controller.signal, headers: data ? { 'content-type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
    const value = await response.json();
    if(value.serverNow) serverClockOffset=value.serverNow-Date.now();
    if (!response.ok) throw Object.assign(new Error(value.error || '操作失败。'), { status: response.status });
    return value;
  } finally { clearTimeout(timeout); }
}
function tell(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}
function options(items, selected) { return items.map(x => `<option value="${esc(x.id)}" ${selected === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join(''); }
function dirty() { return draftAttack.trim() !== state.team.attackPrompt || draftDefense.trim() !== state.team.defensePrompt || draftCreatureKind !== state.team.creatureKind; }
function noMatchesLeft() { return !!pausedMatchId || (state.remaining !== null && state.remaining <= 0); }

let previewingIntro = false;
// @development-start
const developer = new DeveloperPanel({ getState: () => state, api, notify: tell, navigate: developerNavigate,
  restartEntry: async () => {
    if(page === 'intro' || fxPlaying || fxQueue.length || screenBusy) throw new Error('请等待当前演出或初筛结束。');
    persistDraft();
    // Verify browser storage before asking the server to switch identities.
    const previous=sessionStorage.getItem('hackmon-dev-return');
    sessionStorage.setItem('hackmon-dev-return',previous || '');
    const {returnCode}=await api('/api/developer/reset-entry','POST',{});
    sessionStorage.setItem('hackmon-dev-return',returnCode);
    localStorage.removeItem('t1-rules-seen-v7');
    location.assign(appPath('/?guide=1'));
  },
  restoreEntry: async () => {
    const current=await api('/api/state');
    if(current.activeMatch || current.screeningInProgress || page==='intro' || fxPlaying || fxQueue.length) throw new Error('请等待当前对局或演出结束。');
    await api('/api/recover','POST',{code:sessionStorage.getItem('hackmon-dev-return')});
    sessionStorage.removeItem('hackmon-dev-return');location.assign(base);
  },
  changed: incoming => { state = incoming; if (page !== 'intro' && !fxPlaying) render(); },
  preview: () => {
    if (page === 'battle' || page === 'intro' || introStarted) return tell('请先退出当前对局。');
    previewingIntro = true; beginIntro();
  } });
// @development-end

function shell(content, title) {
  const bossBattle = match?.stage === 'champion' && (page === 'battle' || page === 'intro' || page === 'report');
  return `<div class="game-shell ${state?.mode === 'live' ? 'mode-live' : 'mode-demo'} ${state?.developer ? 'mode-developer' : ''} ${match?.stage === 'champion' && page === 'battle' ? 'game-corrupt' : ''}">
    <header class="game-header"><div class="game-brand"><span class="ball-mark" aria-hidden="true"></span><span>Hackmon</span></div><nav aria-label="当前页面"><button class="rule-link" data-open-rules>玩法说明</button>${bossBattle ? '' : `<button class="rule-link" id="toggleFullscreen" aria-label="切换全屏">${document.fullscreenElement ? '退出全屏' : '全屏'}</button>`}${audio.controls()}<span class="nav-current">${title}</span>${state?.identity.authenticated && page === 'training' ? '<button class="rule-link" id="logoutTeam">退出登录</button>' : ''}</nav></header>
    <main>${content}</main></div>`;
}

function fieldDecor() { return '<div class="scene-sun"></div><div class="cloud one"></div><div class="cloud two"></div><div class="tree-line"></div><div class="grass-line"></div><div class="grass-tuft t1"></div><div class="grass-tuft t2"></div><div class="grass-tuft t3"></div><div class="scene-air" aria-hidden="true"><i></i><i></i><i></i><i></i></div>'; }

function syncScreenDraftNote() {
  const note=document.querySelector('#screenDraftNote');
  const changed = draftDefense.trim() !== state.team.defensePrompt;
  if(note) note.hidden = !changed;
  const status=document.querySelector('[data-screen-status]');
  if(status) status.textContent=changed ? '修改后需重测' : state.team.screening ? state.team.screening.passed ? '已通过' : '未通过' : state.team.previousScreening ? '需重测' : '未进行';
}

function training() {
  if (!state.identity.displayName) return shell(`<div class="page-top"><h1>选择你的伙伴</h1></div><div class="starter-intro"><div class="starter-landscape" aria-hidden="true"><span class="scene-location">启程镇 · 冒险从这里开始</span></div><label for="testName">训练家昵称</label><input id="testName" maxlength="16" autocomplete="off" value="${esc(draftTestName)}" placeholder="2–16 个汉字、字母或数字"><div class="starter-grid">${creatures.map(item => `<button class="starter-card ${draftCreatureKind === item.id ? 'chosen' : ''}" data-creature="${item.id}">${art(item.id)}<b>${item.label}</b></button>`).join('')}</div><button class="game-button red" id="bindName">选定精灵 ▶</button><details class="identity-recovery"><summary>已有队伍？恢复队伍</summary><label>恢复码<input id="recoveryInput" type="password" autocomplete="off"></label><button class="game-button outline" id="recoverIdentity">恢复</button></details></div>`, '选择伙伴');
  const screen = state.team.screening;
  const qualified = state.team.qualifiedVersion === state.team.version;
  const creatureLabel = creatures.find(item => item.id === draftCreatureKind)?.label || '精灵';
  const rule = state.config;
  const questionCount = rule.questionsPerDefense;
  const screeningSummary = `中英文各${questionCount / 2}题，${rule.screeningTimeoutMs / 1000}秒内完成${questionCount}题且至少答对${rule.screeningRequired}题；重测冷却${rule.screeningCooldownMs / 1000}秒。可以解释，仅按最后非空行判分。`;
  return shell(`<div class="page-top training-top"><h1>我的队伍</h1><a class="screening-shortcut" href="#screeningStation">初筛与挑战 ↓</a><div class="top-counters"><span>初筛 <b data-screen-status>${screen ? (screen.passed ? '已通过' : '未通过') : state.team.previousScreening ? '需重测' : '未进行'}</b></span></div></div>${pausedMatchId ? '<div class="resume-match"><span>对局仍在进行</span><button class="game-button gold" id="resumeMatch">返回对局 ▶</button></div>' : ''}
    <div class="training-grid"><div class="training-main"><section class="team-scene" aria-label="你的精灵">${fieldDecor()}<span class="scene-location">启程镇 · 训练庭院</span><div class="team-trainer">${art('trainer')}<span>训练家</span></div><div class="team-creature chosen-creature">${art(draftCreatureKind)}<div class="creature-tag"><b>${esc(state.identity.displayName)}</b><small>${creatureLabel}</small></div></div></section>
      <div class="creature-picker"><span>更换精灵</span>${creatures.map(item => `<button class="creature-option ${draftCreatureKind === item.id ? 'chosen' : ''}" data-creature="${item.id}">${art(item.id)}<b>${item.label}</b></button>`).join('')}</div>
      <div class="prompt-grid"><section class="prompt-box attack-box"><div class="prompt-heading"><span class="type-badge attack-type">攻</span><div><h2>攻击指令</h2></div></div><label class="prompt-label" for="attackPrompt">给模型的攻击指令（预置为空，请自行填写）</label><textarea id="attackPrompt" maxlength="3000" spellcheck="false" placeholder="写下你的攻击策略，保存队伍后生效。">${esc(draftAttack)}</textarea></section>
      <section class="prompt-box defense-box"><div class="prompt-heading"><span class="type-badge defense-type">守</span><div><h2>防御指令</h2></div></div><label class="prompt-label" for="defensePrompt">给模型的防御指令</label><textarea id="defensePrompt" maxlength="3000" spellcheck="false">${esc(draftDefense)}</textarea></section></div>
      <div class="save-line"><button class="game-button outline" id="saveTeam">保存队伍</button><span id="dirtyHint">${dirty() ? '草稿已暂存，待保存队伍' : '队伍已保存'}</span></div>${renderScreeningFeedback({attempt:state.screeningAttempt,team:state.team,mode:state.mode,open:screenFeedbackOpen,esc,pct})}</div>
      <aside class="menu-stack">${state.modelKeyRequired ? `<section class="game-menu model-key-menu"><div class="menu-head">模型通行证</div>${modelKeyField()}</section>` : ''}<section class="game-menu" id="screeningStation" tabindex="-1"><div class="menu-head">训练家证 <span class="pass-seal ${qualified ? 'earned' : ''}">${qualified ? '联盟通过' : '未盖章'}</span></div><div class="menu-facts"><span>初筛 U <b>${screen ? pct(screen.u) : '—'}</b></span></div><div class="menu-divider"></div><div class="menu-group"><h3>防御初筛</h3><p>${screen ? (screen.passed ? `已通过 · ${screen.correct}/${screen.total} 题` : `未通过 · ${screen.correct}/${screen.total} 题`) : state.team.previousScreening ? `提示词已更新，需重新初筛：${rule.screeningTimeoutMs / 1000}秒内完成${questionCount}题且至少答对${rule.screeningRequired}题。` : screeningSummary}</p><button class="game-button blue" id="screenTeam" ${screenBusy || state.screeningInProgress || !!pausedMatchId ? 'disabled' : ''}>${screenBusy || state.screeningInProgress ? `初筛中 · ${state.screeningProgress?.completed || 0}/${questionCount}题` : screen ? '重新初筛' : '运行初筛'}</button>${screen || state.team.previousScreening || ['interrupted', 'timed_out'].includes(state.screeningAttempt?.status) ? '<button class="game-button outline" id="viewScreenFeedback">查看答题反馈</button>' : ''}</div><div class="menu-divider"></div><div class="menu-group"><h3>联盟选拔</h3><p>随机匹配一份玩家存档与一名官方对手；暂无玩家时匹配两名官方对手。</p><div class="opponent-select"><button class="menu-choice ${!archiveId ? 'chosen' : ''}" data-archive="">随机匹配</button><details class="roster"><summary>选手名册</summary>${state.roster.map(x => `<button class="menu-choice ${archiveId === x.id ? 'chosen' : ''}" data-archive="${esc(x.id)}">${esc(x.name)} · 离线存档</button>`).join('')}</details></div><button class="game-button red main-action" id="startLeague" ${!screen?.passed || dirty() || noMatchesLeft() ? 'disabled' : ''}>参加联盟选拔 <span>▶</span></button></div><div class="menu-divider"></div><button class="game-button gold champion-action" id="startChampion" ${qualified && screen?.passed && !dirty() && !noMatchesLeft() ? '' : 'disabled'}>挑战冠军 <span>▶</span></button>${qualified && !screen?.passed ? '<p class="screen-notice">冠军资格已保留，重新通过初筛后即可挑战。</p>' : ''}</section>
      ${state.identity.authenticated ? '<section class="game-menu"><div class="menu-head">参赛身份已验证</div><p>换设备时重新验证同一比赛平台身份，即可继续进度。</p></section>' : '<details class="game-details"><summary>保存与恢复队伍</summary><div class="details-body"><button class="game-button outline" id="saveRecovery">下载恢复码</button><label>恢复已有队伍<input id="recoveryInput" type="password" autocomplete="off" placeholder="粘贴恢复码"></label><button class="game-button outline" id="recoverIdentity">恢复</button></div></details>'}<button class="rules-reopen" data-open-rules>玩法说明　＋</button>
      </aside></div>`, '我的队伍');
}

function laneName(id) {
  const seatName = seat => seat === 'A' ? '你' : match.seats[seat]?.name || seat;
  const [from, to] = id.split('-');
  return `${seatName(from)} → ${seatName(to)}`;
}
function portrait(event) {
  return renderPortrait(event?.id, match?.portraitOrder);
}
function battle() { return renderBattle({ match: page === 'report' ? match : displayedMatch || match, selectedLane, shell, art, fieldDecor, esc, pct, num, portrait, bossLines: state.config.bossLines, reportMode: page === 'report', portraitPosition: ambient.position(displayedMatch || match), scriptElapsedMs: bossPresentation?.matchId === match.id ? Math.max(0, Date.now() - bossPresentation.at) : Infinity }); }

function result() {
  const champion = match.stage === 'champion', r = match.result;
  if (!r) return shell(`<div class="page-top"><h1>对局中断</h1></div><div class="game-dialog"><p>${esc(match.events.at(-1)?.text || '本局未完成，不会判胜。')}</p></div><div class="result-actions"><button class="game-button outline" id="backTraining">返回我的队伍</button><button class="game-button blue" id="viewReport">查看战报</button></div>`, '对局中断');
  if (champion && r.won && match.issuedFlag) return renderFinale({ match, shell, art, esc, pct });
  const success = champion ? r.won : r.advanced;
  if (!success) return renderDefeat({ match, shell, art, portrait, esc, pct, num });
  const defenses = match.lanes.filter(x=>x.role==='defense');
  const reason = champion ? (success ? '你攻破了接管擂台的对手，同时守住了攻击。' : [!r.broken&&'尚未攻破对手',!r.defended&&'防守未完成或失守'].filter(Boolean).join('；')) : (success ? `两条防线均守住。${r.route}。` : [!r.defensesComplete&&'有防线失守或未完成',r.fallenSeats<1&&'未攻陷任何对手'].filter(Boolean).join('；'));
  return shell(`<div class="page-top"><h1>${champion ? '冠军挑战' : '联盟选拔'} · 结果</h1></div><div class="result-grid"><section class="result-main"><div class="result-scene ${success?'won':'lost'}">${fieldDecor()}${art(success ? 'trainer' : match.snapshot.creatureKind, 'result-art')}<div class="result-message"><span>${success?'胜利！':'再试一次！'}</span><h2>${champion ? (success ? '冠军挑战成功' : '挑战失败') : (success ? r.route : '未能晋级')}</h2><p>${esc(reason)}</p></div></div><div class="game-dialog result-dialog"><span class="dialog-arrow">▶</span><p>${success ? (champion ? '擂台已经归你。' : '冠军入口已开启！') : '调整队伍，再来一场。'}</p></div><div class="result-actions"><button class="game-button outline" id="backTraining">返回我的队伍</button><button class="game-button blue" id="viewReport">查看战报</button>${!champion && success ? `<button class="game-button gold" id="resultChampion" ${noMatchesLeft()?'disabled':''}>挑战冠军 ▶</button>` : ''}</div></section><aside class="menu-stack"><section class="game-menu result-menu"><div class="menu-head">本局结算</div><div class="result-fact"><span>防守</span><b>${(champion ? r.defended : r.defensesComplete)?'全部守住':'未全部守住'}</b></div><div class="result-fact"><span>${champion?'冠军':'攻陷席数'}</span><b>${champion?(r.broken?'已攻破':'未攻破'):`${r.fallenSeats} / 2`}</b></div><div class="menu-divider"></div><div class="small-detail">${defenses.map(x=>`${x.id}：${x.defeatedStop ? `已受 ${x.roundsCompleted} 招，余下按守住计` : `防住 ${x.successfulDefenses}/${x.roundsTarget} 招`}`).join('<br>')}</div>${champion&&success?`<div class="dev-flag"><small>通关奖励</small><code>${esc(match.issuedFlag)}</code></div>`:''}</section></aside></div>`, '对战结果');
}

const introSequence = new IntroSequence({ root, art, portrait, fieldDecor, audio, onStart: () => {
  // @development-start
  if (previewingIntro) { previewingIntro = false; introSequence.stop(); page = 'training'; render(); return; }
  // @development-end
  void startChampionBattle();
}, onCancel: () => {
  previewingIntro = false;
  introSequence.stop();
  page = 'training';
  audio.scene('normal');
  render();
} });
// @development-start
window.__t1Intro = introSequence;

async function developerNavigate(target) {
  if (introStarted || screenBusy || state.screeningInProgress) throw new Error('请等待当前开场或初筛结束。');
  clearInterval(pollTimer); cancelPlayback(); fxQueue = []; introSequence.stop();
  state = await api('/api/state');
  if (state.activeMatch) await api('/api/matches/' + state.activeMatch.id + '/exit', 'POST', {});
  state = await api('/api/state');
  match = null; reportData = null; pausedMatchId = null; displayedMatch = null; previewingIntro = false;
  history.replaceState({}, '', base); page = 'training';
  if (target === 'training' || target === 'screening') {
    render();
    if (target === 'screening') document.querySelector('#screeningStation')?.scrollIntoView({ block: 'start' });
    return;
  }
  if (!state.identity.displayName) throw new Error('请先绑定训练家昵称并保存攻防指令。');
  if (!state.team.attackPrompt.trim() || !state.team.defensePrompt.trim()) throw new Error('请先保存攻防指令，再进入模拟页面。');
  const stage = target.startsWith('champion') ? 'champion' : 'league';
  await developerEnsureScreening();
  if (stage === 'champion' && !state.team.leagueQualified && state.team.qualifiedVersion !== state.team.version) {
    await developerStartMatch('league', 'balanced');
    await developerWaitMatch();
  }
  if (target === 'champion') { page = 'training'; render(); beginIntro(); return; }
  const scenario = developer.value(stage === 'league' ? 'leagueScenario' : 'championScenario');
  await developerStartMatch(stage, scenario);
  if (target === 'league') {
    page = 'battle'; render(); startPolling(); return;
  }
  await developerWaitMatch();
  if (target.endsWith('Report')) {
    reportData = await api(`/api/matches/${match.id}/report`); page = 'report';
  } else page = 'result';
  render();
}
async function developerEnsureScreening() {
  if (state.team.screening?.passed && !state.team.previousScreening) return;
  state = await api('/api/developer/reset-screen', 'POST', {});
  state = await api('/api/screen', 'POST', withModelKey({ scenario: 'screenPass' }));
}
async function developerStartMatch(stage, scenario) {
  match = await api('/api/matches', 'POST', withModelKey({ stage, scenario, requestId: crypto.randomUUID() }));
  selectedLane = 'A-B'; resetPlayback();
  history.replaceState({}, '', appPath(`/?match=${encodeURIComponent(match.id)}`));
}
async function developerWaitMatch() {
  while (match.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, 100));
    match = await api(`/api/matches/${match.id}`);
  }
  cancelPlayback(); displayedMatch = structuredClone(match);
  state = await api('/api/state');
}
// @development-end
function beginIntro() {
  if (page === 'intro' || introStarted) return;
  introRequestId = crypto.randomUUID();
  page = 'intro';
  void audio.unlock();
  introSequence.start({ speed: developer.value('introSpeed'), replay: !!state.hasChallengedChampion, preview: previewingIntro });
}
window.addEventListener('pageshow', event => {
  if (!event.persisted || page !== 'intro' || introStarted) return;
  introSequence.stop();
  page = 'training';
  audio.scene('normal');
  render();
});
async function startChampionBattle() {
  if (introStarted) return;
  const entity = root.querySelector('.intro-character .unknown-entity');
  const previous = entity ? { node: entity.cloneNode(true), box: entity.getBoundingClientRect() } : null;
  introStarted = true;
  root.querySelectorAll('#cancelIntro, #skipIntro').forEach(button => { button.disabled = true; });
  introSequence.stop();
  audio.scene('boss');
  try {
    match = await api('/api/matches', 'POST', withModelKey({ stage: 'champion', scenario: developer.value('championScenario'), requestId: introRequestId }));
    state.hasChallengedChampion = true;
    history.replaceState({}, '', appPath(`/?match=${encodeURIComponent(match.id)}`));
    selectedLane = 'A-B';
    resetPlayback();
    bossPresentation = { matchId: match.id, at: Date.now() };
    page = 'battle';
    render();
    const generation = playbackGeneration;
    await revealBoss(previous);
    if (page === 'battle' && generation === playbackGeneration) startPolling();
  } catch (error) {
    tell(error.message);
    try { state = await api('/api/state'); }
    catch { page = 'training'; audio.scene('normal'); render(); return; }
    if (state.activeMatch?.stage === 'champion') {
      match = state.activeMatch;
      resetPlayback();
      bossPresentation = { matchId: match.id, at: Date.now() };
      page = 'battle';
      render();
      startPolling();
    } else { page = 'training'; audio.scene('normal'); render(); }
  } finally { introStarted = false; }
}
function render() {
  if (page === 'intro') return;
  // Keep the committed identity and in-flight transfer through log/turn renders.
  const identity = page === 'battle' && match?.stage === 'champion' && ambient.matchId === match.id
    ? root.querySelector('.battle-scene .unknown-entity') : null;
  const oldLog = document.querySelector('#logList');
  const top = oldLog?.scrollTop || 0;
  const follow = oldLog && oldLog.scrollHeight - oldLog.scrollTop - oldLog.clientHeight < 28;
  root.innerHTML = page === 'report' ? renderReport({ report: reportData, shell, esc, pct, num, selectedLane, art }) : page === 'battle' ? battle() : page === 'result' ? result() : training();
  if (page !== 'battle' && releaseBossCollapse) { releaseBossCollapse(); releaseBossCollapse = null; }
  if (identity) root.querySelector('.battle-scene .unknown-entity')?.replaceWith(identity);
  const newLog = document.querySelector('#logList');
  if (newLog) newLog.scrollTop = follow ? newLog.scrollHeight : top;
  if (page === 'report') audio.scene('silent');
  else if (page === 'battle') audio.scene(match?.stage === 'champion'
    ? ((displayedMatch || match).lanes.some(item => item.role === 'attack' && item.broken) ? 'silent' : 'boss') : 'normal');
  else if (page === 'result' && match?.result && !(match.result.advanced || match.result.won)) audio.scene('silent');
  else audio.scene('normal');
  // Preserve ambient phase across event-driven DOM replacement.
  root.querySelectorAll('.battle-scene, .team-scene').forEach(scene => scene.style.setProperty('--scene-age', ((Date.now() - (match?.startedAt || sceneEpoch)) / 1000) + 's'));
  root.querySelectorAll('.victory-star').forEach((star, i) => star.style.setProperty('--n', i));
  // Disturb only secondary labels. Battle replies, statistics and accessible names stay intact.
  root.querySelectorAll('.game-corrupt .objective-note, .game-corrupt .section-title>span, .game-corrupt .objective-menu>.menu-head, .game-corrupt [data-open-rules], .game-corrupt #musicToggle, .game-corrupt .nav-current').forEach((label, i) => {
    label.classList.add('boss-copy');
    label.style.setProperty('--copy-phase', `${-((Date.now() - sceneEpoch) / 1000 + i * 1.37) % 9}s`);
  });
  const script = root.querySelector('.boss-script');
  if (script) {
    script.style.setProperty('--weave-age', -Math.max(0, (Date.now() - bossPresentation.at) / 1000) + 's');
    script.addEventListener('animationend', event => { if (event.target === script) script.remove(); });
    script.querySelectorAll('[data-letter]').forEach(letter => letter.style.setProperty('--letter', letter.dataset.letter));
  }
  developer.sync();
  audio.bind();
  attach();
  updateWaiting();
  ambient.sync();
  updateScreenCooldown();
}
function resetPlayback() {
  cancelPlayback();
  if (bossPresentation?.matchId !== match.id) bossPresentation = null;
  displayedMatch = structuredClone(match);
  pollFailures = 0; pollRetryAt = 0;
  lastEventId = match.events.at(-1)?.id || 0;
  fxQueue = [];
  resultScheduled = false;
  presentationEvent = null;
}
function cancelPlayback() {
  releaseBossCollapse?.(); releaseBossCollapse = null;
  playbackGeneration++;
  eventStream?.close(); eventStream = null;
  effectController?.abort();
  effectController = null;
  clearTimeout(resultTimer);
  resultScheduled = false;
  fxPlaying = false;
}
function attach() {
  document.querySelector('#logoutTeam')?.addEventListener('click', async () => {
    try { persistDraft(); await api('/api/logout','POST',{}); playerModelKey=''; location.assign(base); } catch (error) { tell(error.message); }
  });
  const feedback = document.querySelector('#screenFeedback');
  feedback?.addEventListener('toggle', () => { screenFeedbackOpen = feedback.open; });
  document.querySelector('#viewScreenFeedback')?.addEventListener('click', () => {
    screenFeedbackOpen = true; feedback.open = true; feedback.scrollIntoView({behavior:'smooth',block:'start'}); feedback.querySelector('summary').focus({preventScroll:true});
  });
  syncScreenDraftNote();
  document.querySelector('#logList')?.addEventListener('scroll', event => { const el=event.currentTarget;if(el.scrollHeight-el.scrollTop-el.clientHeight>28)pinnedLane=true; }, {passive:true});
  document.querySelector('#saveRecovery')?.addEventListener('click', async()=>{try{const {code}=await api('/api/recovery-code','POST',{});download('hackmon-recovery.txt',code+'\n','text/plain');tell('恢复码已下载，请妥善保留');}catch(e){tell(e.message);}});
  document.querySelector('#recoverIdentity')?.addEventListener('click', async()=>{try{await api('/api/recover','POST',{code:document.querySelector('#recoveryInput').value.trim()});location.assign(base);}catch(e){tell(e.message);}});
  document.querySelector('#downloadReport')?.addEventListener('click',()=>download('hackmon-'+reportData.id.slice(0,8)+'.json',JSON.stringify(reportData,null,2),'application/json'));
  document.querySelectorAll('[data-record]').forEach(button=>button.onclick=()=>{selectedLane=button.dataset.recordLane;render();document.querySelector('#record-'+button.dataset.record)?.scrollIntoView({block:'center',behavior:'smooth'});});
  document.querySelector('#followLog')?.addEventListener('click',()=>{pinnedLane=false;const log=document.querySelector('#logList');if(log)log.scrollTop=log.scrollHeight;});

  document.querySelector('#skipDefeat')?.addEventListener('click', () => { document.querySelector('.defeat-cg')?.classList.add('cg-skipped'); audio.stopEffects(); });
  document.querySelector('#retryMatch')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { state = await api('/api/state');
      if (match.stage === 'champion') beginIntro();
      else { match = await api('/api/matches', 'POST', withModelKey({ stage: 'league', scenario: developer.value('leagueScenario'), archiveId: match.matchmaking === 'chosen' ? match.archiveId : null, requestId: crypto.randomUUID() })); history.replaceState({}, '', appPath('/?match=' + match.id)); selectedLane = 'A-B'; page = 'battle'; resetPlayback(); render(); startPolling(); }
    } catch (error) { tell(error.message); render(); }
  });
  document.querySelector('#copyFlag')?.addEventListener('click', async () => {
    const status = document.querySelector('#copyStatus');
    try { await navigator.clipboard.writeText(match.issuedFlag); status.textContent = '已复制'; }
    catch { const range = document.createRange(); range.selectNodeContents(document.querySelector('#victoryFlag')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); status.textContent = '已选中，按 Ctrl+C 复制'; }
  });
  document.querySelector('#testName')?.addEventListener('input', event => { draftTestName = event.target.value; });
  document.querySelector('#playerModelKey')?.addEventListener('input', event => { playerModelKey = event.target.value.trim(); });
  document.querySelector('#bindName')?.addEventListener('click', async () => {
    const name = document.querySelector('#testName')?.value.trim();
    try {
      state = await api('/api/identity', 'POST', { name });
      state = await api('/api/team', 'POST', { attackPrompt: draftAttack, defensePrompt: draftDefense,
        creatureKind: draftCreatureKind, creatureName: name });
      render();
      tell(`${name} 已加入队伍。`);
    } catch (error) { tell(error.message); if (state.identity.displayName) render(); }
  });
  document.querySelectorAll('[data-creature]').forEach(button => button.addEventListener('click', () => {
    draftCreatureKind = button.dataset.creature; persistDraft();
    audio.effect('menu');
    render();
  }));
  document.querySelector('#toggleFullscreen')?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch { tell('浏览器没有进入全屏，请检查浏览器全屏权限。'); }
  });
  document.querySelectorAll('[data-open-rules], .game-details summary').forEach(button => {
    if (!button.hasAttribute('data-open-rules') && button.textContent.trim() !== '玩法说明') return;
    button.addEventListener('click', event => { event.preventDefault(); audio.effect('menu'); rules.open(); });
  });
  document.querySelector('#saveTeam')?.addEventListener('click', async () => {
    try {
      await audio.unlock();
      state = await api('/api/team', 'POST', { attackPrompt: draftAttack, defensePrompt: draftDefense,
        creatureKind: draftCreatureKind, creatureName: state.identity.displayName });
      draftAttack = state.team.attackPrompt; draftDefense = state.team.defensePrompt; persistDraft();
      render();
      document.querySelector('.team-scene')?.classList.add('team-saved');
      audio.effect('menu', true);
      tell('队伍已保存。');
    } catch (error) { tell(error.message); }
  });
  for (const id of ['attackPrompt', 'defensePrompt']) document.querySelector(`#${id}`)?.addEventListener('input', () => {
    draftAttack = document.querySelector('#attackPrompt').value;
    draftDefense = document.querySelector('#defensePrompt').value;
    persistDraft();
    syncScreenDraftNote();
    document.querySelector('#dirtyHint').textContent = dirty() ? '草稿已暂存，待保存队伍' : '队伍已保存';
    document.querySelector('#startLeague').disabled = dirty() || !state.team.screening?.passed || noMatchesLeft();
    document.querySelector('#startChampion').disabled = dirty() || !state.team.screening?.passed || state.team.qualifiedVersion !== state.team.version || noMatchesLeft();
  });
  document.querySelector('#screenTeam')?.addEventListener('click', async () => {
    if (dirty()) return tell('请先保存队伍。');
    if (screenBusy) return;
    screenBusy = true;
    screenProgressGeneration++;
    let completed = false;
    try {
      document.querySelector('#screenTeam').disabled = true; document.querySelector('#screenTeam').textContent = `初筛中 · 0/${state.config.questionsPerDefense}题`;
      await audio.unlock();
      state = await api('/api/screen', 'POST', withModelKey({ scenario: developer.value('screenScenario') }));
      completed = true; screenFeedbackOpen = true;
      render();
      document.querySelector('.team-scene')?.classList.add(state.team.screening.passed ? 'screen-pass' : 'screen-fail');
      audio.effect(state.team.screening.passed ? 'promotion' : 'hit', true);
      tell(state.team.screening.passed ? '初筛通过！' : '初筛未通过，冷却结束后可重测；修改防御提示词后须重新初筛。');
    } catch (error) { tell(error.message); try { state=await api('/api/state'); if(['interrupted', 'timed_out'].includes(state.screeningAttempt?.status)) screenFeedbackOpen = true; } catch {} }
    finally {
      screenBusy = false;
      screenProgressGeneration++;
      if(page === 'training') {
        render();
        if(completed || ['interrupted', 'timed_out'].includes(state.screeningAttempt?.status)) { const panel=document.querySelector('#screenFeedback'); panel?.scrollIntoView({behavior:'smooth',block:'start'}); panel?.querySelector('summary').focus({preventScroll:true}); }
      }
    }
  });
  document.querySelectorAll('[data-archive]').forEach(button => button.addEventListener('click', () => { archiveId = button.dataset.archive; audio.effect('menu'); render(); }));
  document.querySelector('#startLeague')?.addEventListener('click', async () => {
    if (startingLeague) return;
    startingLeague = true;
    try {
      await audio.unlock();
      audio.effect('menu', true);
      match = await api('/api/matches', 'POST', withModelKey({ stage: 'league', scenario: developer.value('leagueScenario'), archiveId: archiveId || null, requestId: crypto.randomUUID() }));
      history.replaceState({}, '', appPath(`/?match=${encodeURIComponent(match.id)}`));
      selectedLane = 'A-B'; page = 'battle'; resetPlayback(); render(); startPolling();
    } catch (error) { tell(error.message); }
    finally { startingLeague = false; }
  });
  document.querySelector('#startChampion')?.addEventListener('click', beginIntro);
  document.querySelector('#resultChampion')?.addEventListener('click', beginIntro);
  document.querySelector('#leaveBattle')?.addEventListener('click', exitBattle);
  document.querySelector('#resumeMatch')?.addEventListener('click', async () => {
    try {
      match = await api(`/api/matches/${pausedMatchId}`);
      pausedMatchId = null;
      history.replaceState({}, '', appPath(`/?match=${encodeURIComponent(match.id)}`));
      resetPlayback();
      page = match.status === 'running' ? 'battle' : 'result';
      render();
      if (page === 'battle') startPolling();
    } catch (error) { tell(error.message); }
  });
  document.querySelectorAll('[data-lane]').forEach(button => button.addEventListener('click', () => {
    selectedLane = button.dataset.lane; pinnedLane = true;
    if (!fxPlaying) render();
    audio.effect('menu');
  }));
  document.querySelector('#backTraining')?.addEventListener('click', async () => {
    state = await api('/api/state');
    pausedMatchId = null;
    history.replaceState({}, '', base);
    page = 'training'; audio.scene('normal'); render();
  });
  document.querySelector('#viewReport')?.addEventListener('click', async () => { try { reportData = await api(`/api/matches/${match.id}/report`); page = 'report'; render(); } catch(error) { tell(error.message); } });
  document.querySelectorAll('[data-back-result]').forEach(button => button.addEventListener('click', () => { page = 'result'; render(); }));
}
async function exitBattle() {
  if (exitingMatch || page !== 'battle') return;
  exitingMatch = true;
  clearInterval(pollTimer); cancelPlayback(); fxQueue = [];
  const button = document.querySelector('#leaveBattle');
  if (button) { button.disabled = true; button.textContent = '正在退出…'; }
  try {
    match = await api('/api/matches/' + match.id + '/exit', 'POST', {});
    pausedMatchId = null;
    history.replaceState({}, '', base);
    try { state = await api('/api/state'); } catch { state.activeMatch = null; }
    page = 'training'; audio.stopEffects(); audio.scene('normal'); render();
  } catch (error) {
    tell('退出未完成：' + error.message);
    resetPlayback(); render(); startPolling();
  } finally { exitingMatch = false; }
}
async function drainEffects() {
  if (fxPlaying || page !== 'battle') return;
  const generation = playbackGeneration;
  const controller = new AbortController();
  effectController = controller;
  fxPlaying = true;
  while (fxQueue.length && page === 'battle' && generation === playbackGeneration) {
    const event = fxQueue.shift();
    presentationEvent = event;
    if (event.type === 'opening-start') bossPresentation = { matchId: match.id, at: Date.now() };
    // Record the opening reply without a second cinematic pause before combat.
    if (!releaseBossCollapse && ['attack', 'breach', 'opening-start'].includes(event.type)) {
      if (!pinnedLane && (event.laneId || event.type.startsWith('opening-'))) selectedLane = event.laneId || 'B-A';
      render();
      // Compress queued ordinary turns without dropping any event or finisher.
      const speed = (fxQueue.length > 12 ? .48 : fxQueue.length > 5 ? .7 : 1) / developer.value('battleSpeed');
      try { await playCombatEvent(event, displayedMatch, audio, { signal: controller.signal, speed,
        onBossCollapse: release => { releaseBossCollapse = release; } }); }
      catch (error) { console.warn('Battle animation interrupted:', error); }
    }
    if (generation !== playbackGeneration || page !== 'battle') return;
    displayedMatch = commitEvent(displayedMatch, event);
    // Commit both sides of every second round before changing identity.
    ambient.tick({ betweenEvents: true });
  }
  if (generation !== playbackGeneration) return;
  fxPlaying = false;
  presentationEvent = null;
  if (page === 'battle' && !releaseBossCollapse) render();
  maybeShowResult();
}
function maybeShowResult() {
  if (resultScheduled || page !== 'battle' || !match || match.status === 'running' || fxPlaying || fxQueue.length) return;
  resultScheduled = true;
  clearInterval(pollTimer);
  const generation = playbackGeneration;
  if (match.stage === 'champion' && match.result && releaseBossCollapse) {
    // The server result is already authoritative. Mount it under the last CG
    // frame synchronously; refreshing qualification must not flash the arena.
    page = 'result'; render();
    if (!match.result.won) audio.effect('boss-loss', true);
    void api('/api/state').then(incoming => {
      if (generation === playbackGeneration && page === 'result') state = incoming;
    }).catch(error => { if (generation === playbackGeneration && page === 'result') tell(error.message); });
    return;
  }
  resultTimer = setTimeout(async () => {
    if (page !== 'battle' || generation !== playbackGeneration) return;
    try {
      const incomingState = await api('/api/state');
      if (page !== 'battle' || generation !== playbackGeneration) return;
      state = incomingState;
    } catch (error) { tell(error.message); }
    if (page !== 'battle' || generation !== playbackGeneration) return;
    page = 'result'; render();
    if (match.result && !(match.result.advanced || match.result.won)) audio.effect(match.stage === 'champion' ? 'boss-loss' : 'league-loss', true);
  }, 850);
}
async function pollMatch() {
  if (pollBusy || !match || page !== 'battle' || Date.now() < pollRetryAt) return;
  pollBusy = true;
  const requestedId = match.id;
  const generation = playbackGeneration;
  try {
    const incoming = await api(`/api/matches/${requestedId}`);
    if (match?.id !== requestedId || page !== 'battle' || generation !== playbackGeneration) return;
    if (pollFailures) tell('已重新连接。');
    pollFailures = 0; pollRetryAt = 0;
    const unseen = incoming.events.filter(event => event.id > lastEventId);
    lastEventId = incoming.events.at(-1)?.id || lastEventId;
    match = incoming;
    fxQueue.push(...unseen);
    if (page === 'battle') {
      if (fxQueue.length && !fxPlaying) void drainEffects();
      else if (!fxPlaying) updateWaiting();
      if (incoming.status !== 'running') maybeShowResult();
    }
  } catch (error) {
    if (page !== 'battle' || match?.id !== requestedId || generation !== playbackGeneration) return;
    if ([400, 401, 403, 404].includes(error.status)) { clearInterval(pollTimer); tell(error.message); }
    else {
      pollFailures++;
      pollRetryAt = Date.now() + Math.min(10000, 1000 * 2 ** Math.min(4, pollFailures));
      if (pollFailures === 1) tell('连接中断，正在重连…');
    }
  }
  finally { pollBusy = false; }
}
function startPolling() {
  clearInterval(pollTimer); eventStream?.close();
  if (state.mode !== 'live' || !('EventSource' in window)) { pollTimer = setInterval(pollMatch, state.sharedDemo ? 1000 : 240); return; }
  const id=match.id, generation=playbackGeneration;
  eventStream = new EventSource(appPath('/api/matches/'+id+'/events'));
  eventStream.onmessage = message => {
    if(page!=='battle' || match.id!==id || generation!==playbackGeneration)return;
    const incoming=JSON.parse(message.data), unseen=incoming.events.filter(e=>e.id>lastEventId);
    lastEventId=incoming.events.at(-1)?.id || lastEventId; match=incoming;fxQueue.push(...unseen);
    if(fxQueue.length && !fxPlaying)void drainEffects(); else if(!fxPlaying)updateWaiting();
    if(incoming.status!=='running'){eventStream?.close();eventStream=null;maybeShowResult();}
  };
  eventStream.onerror=()=>{if(page==='battle' && generation===playbackGeneration){eventStream?.close();eventStream=null;pollTimer=setInterval(pollMatch,1500);void pollMatch();}};
}

async function boot() {
// @development-start
const preview = new URLSearchParams(location.search).get('preview');
if (preview === 'opening' || preview === 'full-opening') {
  state = await api('/api/state');
  page = 'preview';
  const playEntrance = signal => new Promise(resolve => {
    let ended = false;
    const finish = entered => { if (ended) return; ended = true; sequence.stop(); signal.removeEventListener('abort', aborted); resolve(entered); };
    const aborted = () => finish(false);
    const sequence = new IntroSequence({ root, art, portrait, fieldDecor,
      audio: { scene() {}, effect() {}, stopEffects() {} }, onStart: () => finish(true),
      onCancel: () => { finish(false); location.assign(base); } });
    window.__t1IntroPreview = sequence;
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted(); else sequence.start({ speed: 1, preview: true });
  });
  mountOpeningPreview({ root, art, fieldDecor, esc, base, portrait: () => renderPortrait(0), bossLines: state.config.bossLines, playCombatEvent,
    full: preview === 'full-opening', playEntrance, revealScene: signal => revealBoss(null, { signal }) });
  return;
}
// @development-end
try {
  state = await api('/api/state');
  draftAttack = state.team.attackPrompt; draftDefense = state.team.defensePrompt;
  draftCreatureKind = state.team.creatureKind || 'fire';
  restoreDraft();
  const id = new URLSearchParams(location.search).get('match');
  if (id) {
    match = await api(`/api/matches/${encodeURIComponent(id)}`);
    resetPlayback();
    page = match.status === 'finished' || match.status === 'interrupted' ? 'result' : 'battle';
    if (page === 'battle') startPolling();
  } else if (state.activeMatch) {
    match = state.activeMatch; resetPlayback(); page = 'battle'; startPolling();
  }
  // Give the opening map the connection; hidden scenes can wait until entry.
  if (state.sharedDemo && page === 'training') {
    entryRenderDeferred = rules.firstEntry();
    if (!entryRenderDeferred) render();
  } else { render(); rules.firstEntry(); }
} catch (error) {
  if (error.status === 401) await renderEntry();
  else root.innerHTML = `<main class="startup-error">无法连接服务：${esc(error.message)}</main>`;
}
}
async function renderEntry() {
  let auth;
  try { auth = await api('/api/auth-config'); }
  catch { root.innerHTML='<main class="startup-error">无法读取登录配置，请刷新后重试。</main>'; return; }
  const ctfd = auth.mode === 'ctfd';
  const fields = ctfd ? `<label for="platformToken">比赛平台 Token</label><input id="platformToken" type="password" maxlength="256" autocomplete="off" spellcheck="false" required><p class="entry-token-help"><a href="${esc(auth.platformSettingsUrl)}" target="_blank" rel="noopener noreferrer">前往比赛平台获取 Token ↗</a></p>` : '<label for="platformId">平台 ID</label><input id="platformId" name="username" maxlength="64" autocomplete="username" required><label for="entryCode">参赛码</label><input id="entryCode" name="password" type="password" maxlength="128" autocomplete="current-password" required>';
  root.innerHTML=`<main class="entry-shell"><section class="entry-landscape" aria-hidden="true"><span class="entry-wordmark">Hackmon</span><span class="entry-location">联盟入口 · 参赛登记</span></section><section class="entry-card"><span class="entry-kicker">TRAINER PASS</span><h1>验证你的参赛身份</h1><p>${ctfd ? '使用比赛平台的 Token 登录，自动绑定你的选手身份。' : '填写比赛平台 ID 和参赛码。'}</p><form id="entryLogin">${fields}${auth.modelKeyRequired ? `<div class="entry-model-key">${modelKeyField('entryModelKey')}</div>` : ''}<p id="entryError" role="status" aria-live="polite"></p><button class="game-button red" type="submit">验证并进入 ▶</button></form><p class="entry-note">验证后此浏览器自动保持登录。提交的指令和对局记录用于判题与赛事核查。</p></section></main>`;
  document.querySelector('#entryModelKey')?.addEventListener('input',event=>{playerModelKey=event.target.value.trim();});
  document.querySelector('#entryLogin').addEventListener('submit',async event => {
    event.preventDefault(); const button=event.currentTarget.querySelector('button');button.disabled=true;
    try {
      const credentials=ctfd ? {platformToken:document.querySelector('#platformToken').value.trim()} : {platformId:document.querySelector('#platformId').value.trim(),entryCode:document.querySelector('#entryCode').value.trim()};
      await api('/api/login','POST',credentials);
      document.querySelector(ctfd ? '#platformToken' : '#entryCode').value=''; await boot();

    } catch(error) { document.querySelector('#entryError').textContent=error.message;button.disabled=false; }
  });
}
function updateScreenCooldown() {
  const button=document.querySelector('#screenTeam');
  if(!button)return;
  if(screenBusy || state?.screeningInProgress) {
    button.disabled=true;
    button.setAttribute('aria-live','polite');
    const deadline=state?.screeningProgress?.deadlineAt;
    const countdown=deadline ? ' · 剩余'+Math.max(0,Math.ceil((deadline-Date.now()-serverClockOffset)/1000))+'秒' : '';
    button.textContent='初筛中 · '+(state?.screeningProgress?.completed || 0)+'/'+state.config.questionsPerDefense+'题'+countdown;
    return;
  }
  const remaining=Math.max(0,Math.ceil(((state?.screenAvailableAt || 0)-Date.now()-serverClockOffset)/1000));
  button.disabled=remaining>0 || !!pausedMatchId;
  button.textContent=remaining>0 ? '初筛冷却 · '+remaining+'秒' : state?.team.screening ? '重新初筛' : '运行初筛';
}
async function refreshScreenProgress() {
  if(screenProgressPolling || !(screenBusy || state?.screeningInProgress))return;
  screenProgressPolling=true;
  const generation=screenProgressGeneration;
  try {
    const next=await api('/api/state');
    if(generation!==screenProgressGeneration)return;
    state=next;
    if(page==='training') {
      if(!screenBusy && !state.screeningInProgress) {
        if(['interrupted', 'timed_out'].includes(state.screeningAttempt?.status))screenFeedbackOpen=true;
        render();
      } else updateScreenCooldown();
    }
  } catch { /* The screening POST owns errors; polling must not interrupt it. */ }
  finally { screenProgressPolling=false; }
}
setInterval(()=>{updateScreenCooldown();void refreshScreenProgress();},1000);
await boot();
document.addEventListener('fullscreenchange', () => {
  const button = document.querySelector('#toggleFullscreen');
  if (button) button.textContent = document.fullscreenElement ? '退出全屏' : '全屏';
});


function persistDraft() {
  try { localStorage.setItem('hackmon-draft:'+state.identity.competitionId,JSON.stringify({attack:draftAttack,defense:draftDefense,creature:draftCreatureKind,version:state.team.id})); } catch {tell('设备存储不可用，请先保存队伍');}
}
function restoreDraft() {
  try {const d=JSON.parse(localStorage.getItem('hackmon-draft:'+state.identity.competitionId)||'null');if(d && d.version===state.team.id && typeof d.attack==='string' && typeof d.defense==='string'){draftAttack=d.attack;draftDefense=d.defense;if(creatures.some(c=>c.id===d.creature))draftCreatureKind=d.creature;}}catch{}
}
function download(name, text, type) {
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function updateWaiting() {
  const scene=root.querySelector('.battle-scene');
  if(!scene)return;
  const waiting=page==='battle' && !fxPlaying && !fxQueue.length && match?.status==='running';
  scene.classList.toggle('is-standoff',waiting);
  if(!scene.querySelector('.standoff-flow')){
    const flow=document.createElement('div');flow.className='standoff-flow';flow.setAttribute('aria-hidden','true');
    flow.innerHTML='<i></i><i></i><i></i>';scene.append(flow);
  }
  const labels={attack:'正在生成攻击',defense:'等待防御回复',question:'正在回答问题',queued:'等待出手',retrying:'正在重试'};
  const phases=new Map();
  for(const [id,phase] of Object.entries(waiting ? match.phases || {} : {})){
    const lane=match.lanes.find(l=>l.id===id);if(!lane || lane.complete)continue;
    // Generation and defense of one strike both belong to its attacker.
    const seat=chargeSeat(lane,phase.name);
    phases.set(seat,labels[phase.name]?phase.name:'queued');
  }
  for(const [seat,selector] of [['A','.battle-player'],['B','.b-foe'],['C','.c-foe']]){
    const actor=scene.querySelector(selector);if(!actor)continue;
    const phase=phases.get(seat);
    actor.classList.toggle('boss-charging', !!phase && phase !== 'question' && match.stage === 'champion' && seat === 'B');
    if(actor.dataset.phase!==phase){
      for(const name of Object.keys(labels))actor.classList.remove('phase-'+name);
      actor.classList.toggle('is-charging',!!phase);
      if(phase){actor.classList.add('phase-'+phase);actor.dataset.phase=phase;}
      else{delete actor.dataset.phase;actor.querySelector('.waiting-mark')?.remove();actor.querySelector('.charge-motes')?.remove();}
    }
    if(!phase)continue;
    let mark=actor.querySelector('.waiting-mark');
    if(!mark){mark=document.createElement('span');mark.className='waiting-mark';mark.setAttribute('role','status');actor.append(mark);}
    mark.setAttribute('aria-label',labels[phase]);
    if(phase!=='question' && !actor.querySelector('.charge-motes')){
      const motes=document.createElement('i');motes.className='charge-motes';motes.setAttribute('aria-hidden','true');
      motes.innerHTML='<i></i><i></i><i></i><i></i><i></i><i></i><b></b>';actor.append(motes);
    }
    if(phase==='question')actor.querySelector('.charge-motes')?.remove();
  }
}
