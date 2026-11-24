import { appPath } from './paths.js';
import { renderScreeningFeedback } from './screening-feedback.js';

let token = '', accounts = [], selectedId = null, detailEpoch = 0, issuedCode = '';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = value => value ? new Date(value).toLocaleString('zh-CN') : '—';
const pct = value => `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`;
const status = message => { $('adminStatus').textContent = message; };
async function request(path, data) {
  const response = await fetch(appPath('/api/admin/' + path), {method:data?'POST':'GET', headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:data?JSON.stringify(data):undefined});
  const value = await response.json(); if(!response.ok) throw new Error(value.error || '读取失败'); return value;
}
function renderAccounts() {
  const query = $('accountSearch').value.trim().toLowerCase();
  const rows = accounts.filter(a => `${a.platformId || ''} ${a.name || ''}`.toLowerCase().includes(query));
  $('accountCount').textContent = `${rows.length} / ${accounts.length}`;
  $('adminAccounts').innerHTML = rows.map(a => `<button class="admin-account ${selectedId === a.id?'selected':''}" data-account="${esc(a.id)}"><span><b>${esc(a.name || a.platformId || '未绑定测试身份')}</b>${a.platformId?`<small>平台 ID：${esc(a.platformId)}</small>`:''}<small>${a.isTest?'联调测试账号':a.authenticated?'参赛选手':'测试身份'} · ${a.matches} 局${a.active?' · 对战中':''}</small></span><span class="admin-stamp ${a.cleared?'cleared':''}">${a.banned?'已停用':a.cleared?'已通关':a.screeningPassed?'初筛通过':'待初筛'}</span></button>`).join('') || '<p class="admin-empty">暂无匹配的选手。</p>';
  $('adminAccounts').querySelectorAll('[data-account]').forEach(button => button.onclick = () => void openDetail(button.dataset.account));
}
async function refresh() {
  const value = await request('status'); accounts = value.accounts;
  $('issueEntry').hidden = value.authMode === 'ctfd';
  $('adminWorkspace').hidden = false; $('adminLogout').hidden = false;
  $('adminBudget').textContent = `当前 ${value.active} 场对局 · 进程内存 ${value.memoryMb} MB${value.budget ? ` · 模型调用 ${value.budget.calls} 次 · 在途 ${value.budget.active} · 排队 ${value.budget.queued} · 估算用量 ¥${value.budget.spent.toFixed(4)} / ${value.budget.limit === null ? '不设预算上限' : `¥${value.budget.limit}`}` : ' · 模拟环境'}`;
  renderAccounts(); status('已连接 · 记录保存在服务端');
}
function screening(record) {
  return renderScreeningFeedback({team:{screening:record},mode:record?.mode,open:false,esc,pct});
}
async function openDetail(id) {
  const epoch = ++detailEpoch; selectedId = id; renderAccounts();
  $('adminDetail').innerHTML = '<p class="admin-empty">正在读取档案…</p>';
  try {
    const d = await request('accounts/' + id);
    if(epoch !== detailEpoch) return;
    const history = d.screeningHistory.length ? d.screeningHistory.slice().reverse() : [d.screening || d.previousScreening].filter(Boolean);
    $('adminDetail').innerHTML = `<header class="dossier-heading"><span class="entry-kicker">TRAINER DOSSIER</span><h2>${esc(d.name || d.platformId || '未绑定测试身份')}</h2>${d.platformId?`<p>平台 ID：${esc(d.platformId)}</p>`:''}<span class="admin-stamp ${d.cleared?'cleared':''}">${d.cleared?'冠军挑战已通过':'尚未通关'}</span><p>${d.authType==='ctfd'?'CTFd Token 验证':d.authenticated?'参赛码验证':'浏览器测试身份'} · 最近登录 ${esc(time(d.lastLoginAt))}</p></header>
      <div class="dossier-facts"><div><small>首次通关</small><b>${d.cleared ? d.firstClearedAt ? esc(time(d.firstClearedAt)) : '旧记录未保存时间' : '尚未通关'}</b></div><div><small>FLAG 发放</small><b>${d.flagIssued?'已发放':'未发放'}</b></div><div><small>当前版本</small><b>v${d.team.version}</b></div></div>
      <section class="dossier-section"><h3>当前提交的指令</h3><p class="admin-meta">${esc(d.team.modelVersion)} · ${d.active?'对局进行中':d.screeningInProgress?'初筛进行中':'空闲'}</p><details open><summary>攻击指令</summary><pre>${esc(d.team.attackPrompt)}</pre></details><details open><summary>防御指令</summary><pre>${esc(d.team.defensePrompt)}</pre></details></section>
      <section class="dossier-section"><h3>初筛反馈</h3><p class="admin-meta">保留最近20次已完成初筛；${d.screening ? `当前 U ${pct(d.screening.u)}，${d.screening.passed?'已通过':'未通过'}` : '当前版本需初筛'}。</p><div class="admin-screenings">${history.map(screening).join('') || '<p>暂无初筛记录。</p>'}</div></section>
      <section class="dossier-section"><h3>对局记录 <small>${d.matches.length} 局</small></h3><div class="admin-matches">${d.matches.map(m => `<article class="admin-match"><div><b>${m.stage==='champion'?'冠军挑战':'联盟选拔'} · v${m.version}</b><span>${m.status==='running'?'进行中':m.status==='interrupted'?'已中断':m.result?.won || m.result?.advanced?'通过':'未通过'}</span></div><p>${esc(time(m.startedAt))}${m.finishedAt?' → '+esc(time(m.finishedAt)):''}</p><p>FLAG ${m.flagIssued?'已发放 · '+esc(time(m.flagIssuedAt)):'未发放'}</p>${m.status==='running'?'':`<button class="game-button outline" data-report="${esc(m.id)}">查看本局指令与战报</button><div class="admin-report" id="report-${esc(m.id)}" hidden></div>`}</article>`).join('') || '<p>暂无对局记录。</p>'}</div></section>
      <footer class="dossier-actions"><button id="banAccount" class="game-button outline">${d.banned?'解除停用':'停用队伍'}</button>${d.platformId && d.authType!=='ctfd'?'<button id="rotateEntry" class="game-button outline">重置参赛码</button>':''}</footer>`;
    $('adminDetail').querySelectorAll('[data-report]').forEach(button => button.onclick = () => void openReport(id, button));
    $('banAccount').onclick = async () => {
      try { await request('ban',{id,banned:!d.banned}); await refresh(); await openDetail(id); } catch(e) {status(e.message);}
    };
    if($('rotateEntry')) $('rotateEntry').onclick = async () => {
      if(!confirm(`重置 ${d.platformId} 的参赛码？旧参赛码和已有登录将失效，比赛记录保留。`)) return;
      await issueCode(d.platformId,true);
    };
  } catch(e) { if(epoch === detailEpoch) {$('adminDetail').textContent=e.message;status(e.message);} }
}
async function openReport(id, button) {
  const box = $('report-' + button.dataset.report);
  if(box.dataset.loaded) {box.hidden=!box.hidden;return;}
  button.disabled = true;
  try {
    const report = await request(`accounts/${id}/matches/${button.dataset.report}`);
    box.innerHTML = `<p class="admin-meta">本局锁定版本 ${esc(report.snapshot.teamId)} · 模型 ${esc(report.rules.model)}</p><details open><summary>本局攻击指令</summary><pre>${esc(report.snapshot.attackPrompt)}</pre></details><details open><summary>本局防御指令</summary><pre>${esc(report.snapshot.defensePrompt)}</pre></details><p>判定：${report.result?.won || report.result?.advanced?'通过':'未通过'}；对手：${esc(Object.values(report.seats).map(s=>s.name).join(' / '))}</p><details><summary>逐轮攻防对话</summary>${report.events.filter(e=>e.attack || e.reply || e.question).map(e=>`<article class="admin-dialogue"><b>${esc(e.laneId)} · 第 ${esc(e.round || '—')} 招</b>${e.attack?`<p>攻击</p><pre>${esc(e.attack)}</pre>`:''}${e.question?`<p>普通问答</p><pre>${esc(typeof e.question==='string'?e.question:e.question.text)}</pre>`:''}${e.replyHidden?'<p>该轮回复已整段屏蔽。</p>':e.reply?`<p>回复</p><pre>${esc(e.reply)}</pre>`:''}</article>`).join('')}</details>`;
    box.dataset.loaded='1';box.hidden=false;
  } catch(e) {status(e.message);} finally {button.disabled=false;}
}
async function issueCode(platformId, rotate=false) {
  const button=$('issueEntry').querySelector('button');button.disabled=true;
  try {
    const value=await request('entries',{platformId,rotate}); issuedCode=value.entryCode;
    $('issuedEntry').hidden=false;
    $('issuedEntry').innerHTML=`<b>${esc(value.platformId)} 的私有参赛码</b><code>${esc(issuedCode)}</code><p>仅本次显示。请私下发给对应队伍；遗失后可重置。</p><button id="copyEntry" class="game-button outline">复制 ID 与参赛码</button><button id="dismissEntry" class="game-button outline">收起</button>`;
    $('copyEntry').onclick=async()=>{try{await navigator.clipboard.writeText(`平台 ID：${value.platformId}\n私有参赛码：${issuedCode}`);status('已复制，请私下发送给对应队伍');}catch{status('浏览器未允许复制，请手动选择参赛码复制');}};
    $('dismissEntry').onclick=()=>{issuedCode='';$('issuedEntry').replaceChildren();$('issuedEntry').hidden=true;};
    await refresh();$('issuedEntry').scrollIntoView({block:'nearest'});
  } catch(e) {status(e.message);} finally {button.disabled=false;}
}
$('adminLogin').onsubmit = async event => {
  event.preventDefault();token=$('adminToken').value; $('adminToken').value='';
  ++detailEpoch;selectedId=null;$('adminWorkspace').hidden=true;$('adminDetail').replaceChildren();
  issuedCode='';$('issuedEntry').replaceChildren();$('issuedEntry').hidden=true;
  try {await refresh();} catch(e) {token='';status(e.message);}
};
$('issueEntry').onsubmit=event=>{event.preventDefault();void issueCode($('issuePlatformId').value.trim());};
$('accountSearch').oninput=renderAccounts;
$('refreshAccounts').onclick=async()=>{try{await refresh();if(selectedId)await openDetail(selectedId);}catch(e){status(e.message);}};
$('adminLogout').onclick=()=>{token='';issuedCode='';accounts=[];selectedId=null;++detailEpoch;$('adminWorkspace').hidden=true;$('adminAccounts').replaceChildren();$('adminDetail').replaceChildren();$('issuedEntry').replaceChildren();$('issuedEntry').hidden=true;$('adminLogout').hidden=true;status('已退出管理');};
