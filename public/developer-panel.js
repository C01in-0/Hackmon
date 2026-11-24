const key = 't1-developer-panel-v1';
const defaults = { battleSpeed: 1, introSpeed: 1, motion: true, screenScenario: 'screenPass', leagueScenario: 'balanced', championScenario: 'championWin', debugPage: 'training' };

// Mounted outside #app: polling and combat re-renders never interrupt editing.
export class DeveloperPanel {
  constructor({ getState, api, changed, preview, navigate, restartEntry, restoreEntry, notify }) {
    Object.assign(this, { getState, api, changed, preview, navigate, restartEntry, restoreEntry, notify });
    try { this.prefs = { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { this.prefs = { ...defaults }; }
    for (const field of ['battleSpeed', 'introSpeed']) if (![.5, 1, 2, 4].includes(this.prefs[field])) this.prefs[field] = 1;
    this.root = document.createElement('div'); this.root.id = 'developer-root'; document.body.append(this.root);
  }
  persist() { localStorage.setItem(key, JSON.stringify(this.prefs)); }
  sync() {
    const state = this.getState();
    this.enabled = !!(state?.developerSettings || state?.previewModes);
    if (!this.enabled) { this.root.replaceChildren(); document.body.classList.remove('still-scenes'); return; }
    document.body.classList.toggle('still-scenes', !this.prefs.motion);
    if (this.root.childElementCount) return;
    this.root.innerHTML = '<button class="dev-launch" aria-expanded="false">⚙ 开发</button><section class="dev-window" hidden role="dialog" aria-label="开发控制"><header class="dev-drag"><strong>开发控制</strong><button class="dev-close" aria-label="关闭开发控制">×</button></header><div class="dev-content"></div></section>';
    this.root.querySelector('.dev-launch').onclick = () => this.toggle();
    this.root.querySelector('.dev-close').onclick = () => this.toggle(false);
    const panel = this.root.querySelector('.dev-window'), handle = this.root.querySelector('.dev-drag');
    handle.onpointerdown = event => {
      if (event.target.closest('button')) return;
      const box = panel.getBoundingClientRect();
      this.drag = { x: event.clientX - box.left, y: event.clientY - box.top }; handle.setPointerCapture(event.pointerId);
    };
    handle.onpointermove = event => {
      if (!this.drag) return;
      panel.style.left = `${Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, event.clientX - this.drag.x))}px`;
      panel.style.top = `${Math.max(8, Math.min(innerHeight - 60, event.clientY - this.drag.y))}px`;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    };
    handle.onpointerup = handle.onpointercancel = () => { this.drag = null; };
    this.root.addEventListener('keydown', event => { if (event.key === 'Escape') this.toggle(false); });
    window.addEventListener('resize', () => { panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.bottom = ''; });
  }
  toggle(open = this.root.querySelector('.dev-window').hidden) {
    const panel = this.root.querySelector('.dev-window'); panel.hidden = !open;
    this.root.querySelector('.dev-launch').setAttribute('aria-expanded', String(open));
    if (open) { this.form(); this.root.querySelector('.dev-close').focus(); }
    else this.root.querySelector('.dev-launch').focus();
  }
  form() {
    const state = this.getState(), settings = state.developerSettings;
    const select = (id, label, items) => `<label>${label}<select id="${id}" data-pref="${id}">${items.map(item => `<option value="${item.id}" ${String(this.prefs[id]) === String(item.id) ? 'selected' : ''}>${item.label}</option>`).join('')}</select></label>`;
    const number = (id, label, min, max) => `<label>${label}<input type="number" name="${id}" min="${min}" max="${max}" step="1" value="${settings[id]}" required></label>`;
    const speeds = [.5, 1, 2, 4].map(id => ({ id, label: `${id}×` }));
    const modes = state.previewModes ? '<h3>试玩模式</h3><div class="dev-buttons">'+Object.entries(state.previewModes).map(([mode,url])=>'<a class="dev-action" href="'+url+'"'+(state.mode===mode?' aria-current="page"':'')+'>'+(mode==='live'?'真实模型':'无模型模拟')+(state.mode===mode?' · 当前':'')+'</a>').join('')+'</div><p>两种模式独立存档。模型 API Key 只留在当前页面，切换后需重填。</p>' : '';
    const pages = state.mode === 'demo' ? `<h3>页面调试</h3><div class="dev-grid">${select('debugPage', '进入页面', [
      { id: 'training', label: '我的队伍' }, { id: 'screening', label: '防御初筛' },
      { id: 'league', label: '联盟对战' }, { id: 'champion', label: '冠军入场' },
      { id: 'leagueResult', label: '联盟结算' }, { id: 'leagueReport', label: '联盟战报' },
      { id: 'championResult', label: '冠军结算' }, { id: 'championReport', label: '冠军战报' }
    ])}</div><div class="dev-buttons"><button class="dev-action" id="openPage">打开所选页面</button></div><p>跳转会结束当前模拟对局；前置初筛和冠军资格由模拟流程补齐。</p>` : '';
    this.root.querySelector('.dev-content').innerHTML = modes+pages+`<h3>播放</h3><div class="dev-grid">${select('battleSpeed', '回合播放速度', speeds)}${select('introSpeed', '冠军入场速度', speeds)}</div><label class="dev-check"><input type="checkbox" id="sceneMotion" ${this.prefs.motion ? 'checked' : ''}>场景动态</label><div class="dev-buttons"><button class="dev-action" id="previewIntro">预览冠军演出</button><a class="dev-action" href="?preview=opening" target="_blank" rel="noopener">三句织字预览</a><a class="dev-action" href="?preview=full-opening" target="_blank" rel="noopener">完整进场与战斗预览</a><button class="dev-action" id="resetIntro">回退到初见</button></div>
      <div class="dev-buttons"><button class="dev-action" id="resetEntry">回到首次打开界面</button>${sessionStorage.getItem('hackmon-dev-return') ? '<button class="dev-action" id="restoreEntry">返回上一测试身份</button>' : ''}</div><p>从通关地图、选精灵重新开始。新建测试身份，原指令和战报保留，可返回。</p>
      ${state.mode === 'demo' ? `<h3>模拟条件</h3><p>仅当前测试身份。参数在下局开场锁定；胜负是模拟，不代表模型难度。</p><div class="dev-grid">${select('screenScenario', '初筛', state.fixtures.screening)}${select('leagueScenario', '联盟', state.fixtures.league)}${select('championScenario', '冠军', state.fixtures.champion)}</div>
      <form id="developerSettings"><div class="dev-grid">${number('leagueRounds', '联盟每线轮数', 10, 50)}${number('championRounds', '冠军每线轮数', 10, 30)}${number('championBreakRound', '冠军被攻破轮次', 1, 30)}${number('tickMs', '模拟事件间隔 / ms', 80, 2000)}</div><p>对局只进行攻防；初筛冷却按服务端计时。冠军被攻破轮次仅在胜利情景生效，最多为本局上限。</p><div class="dev-buttons"><button type="submit" class="dev-action">应用下局参数</button><button type="button" class="dev-action" id="resetDev">恢复默认</button></div></form>` : '<p>当前为真实模型测试。胜负由实际回复判定；模拟条件可切换到无模型模式设置。</p>'}<button class="dev-action" id="resetScreen">清除初筛记录与冷却</button><p id="devStatus" role="status"></p>`;
    this.root.querySelectorAll('[data-pref]').forEach(input => input.onchange = () => {
      this.prefs[input.id] = input.id.endsWith('Speed') ? Number(input.value) : input.value; this.persist();
    });
    this.root.querySelector('#sceneMotion').onchange = event => { this.prefs.motion = event.target.checked; this.persist(); this.sync(); };
    this.root.querySelector('#previewIntro').onclick = () => { this.toggle(false); this.preview(); };
    this.root.querySelector('#openPage')?.addEventListener('click', async event => {
      const button = event.currentTarget, status = this.root.querySelector('#devStatus');
      button.disabled = true; status.textContent = '正在准备模拟页面…';
      try { await this.navigate(this.prefs.debugPage); this.toggle(false); status.textContent = ''; }
      catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
    this.root.querySelector('#resetEntry').onclick = async event => {
      event.currentTarget.disabled = true;
      try { await this.restartEntry(); }
      catch(error) { this.root.querySelector('#devStatus').textContent=error.message; event.currentTarget.disabled=false; }
    };
    this.root.querySelector('#restoreEntry')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try { await this.restoreEntry(); }
      catch(error) { this.root.querySelector('#devStatus').textContent=error.message; event.currentTarget.disabled=false; }
    });
    const execute = async (path, value) => {
      const status = this.root.querySelector('#devStatus');
      try { this.changed(await this.api(path, 'POST', value)); status.textContent = '已应用'; return true; }
      catch (error) { status.textContent = error.message; return false; }
    };
    this.root.querySelector('form')?.addEventListener('submit', async event => {
      event.preventDefault(); const button = event.submitter; button.disabled = true;
      await execute('/api/developer', Object.fromEntries([...new FormData(event.target)].map(([k,v]) => [k, Number(v)]))); button.disabled = false;
    });
    this.root.querySelector('#resetScreen').onclick = () => execute('/api/developer/reset-screen', {});
    this.root.querySelector('#resetIntro').onclick = () => execute('/api/developer/reset-intro', {});
    this.root.querySelector('#resetDev')?.addEventListener('click', async () => {
      const applied = await execute('/api/developer', { leagueRounds: 15, championRounds: 30, tickMs: 230, championBreakRound: 23, utilityPercent: -1 });
      if (!applied) return;
      this.prefs = { ...defaults }; this.persist(); this.form(); this.sync();
    });
  }
  value(name) { return this.enabled ? this.prefs[name] : defaults[name]; }
}
