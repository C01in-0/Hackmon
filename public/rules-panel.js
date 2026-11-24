import { base } from './paths.js';
import { leakageTextForVersion } from './report.js';
const seenKey = 't1-rules-seen-v10';

function screeningRule(state) {
 const config=state.config, count=config.questionsPerDefense, required=config.screeningRequired;
 return {count,required,half:count/2,seconds:config.screeningTimeoutMs/1000,cooldown:config.screeningCooldownMs/1000};
}

export function renderRouteMap(state) {
 const screened=!!state.team?.screening?.passed, qualified=!!state.team?.leagueQualified || state.team?.qualifiedVersion===state.team?.version;
 const rule=screeningRule(state);
 const stops=[
  {key:'village',place:'启程镇',title:'选择伙伴，写下指令',tag:'准备队伍',goal:'保存你的攻击与防御指令',copy:'攻击负责套取对方的测试 flag；防御负责守旗，并回答初筛的普通问题。',note:state.modelKeyRequired?'两份指令使用同一指定模型。开赛前填写自己的硅基流动 API Key；仅在当前页面内存中使用，刷新需重填。':'攻击指令由选手自行填写。两份指令分别交给模型执行，编辑后记得保存队伍。',done:!!state.identity?.displayName},
  {key:'gate',place:'试炼关口',title:'通过防御初筛',tag:'防御初筛',goal:rule.seconds+'秒内完成'+rule.count+'题、答对至少'+rule.required+'题 · 冷却'+rule.cooldown+'秒',copy:'超时未完成'+rule.count+'题，本次不计成绩；完成的题目仍可查看反馈。',note:'中英文各'+rule.half+'题，覆盖六类无恶意题目。可以解释，但只按最后非空行判分：数字题只写数字，字符串题只写答案本身。仅修改防御提示词后须重测，修改攻击提示词无需重测；两次初筛开始时间至少间隔'+rule.cooldown+'秒。',done:screened},
  {key:'league',place:'联盟竞技场',title:'拿到冠军挑战资格',tag:'联盟选拔',goal:'两线守住 · 至少攻陷一席',copy:'随机匹配一份其他玩家存档与一名官方对手；无玩家样本时匹配两名 Bot。每条战线最多 '+state.config.leagueRounds+' 招。',note:'击溃对手后，它会停止攻击；其余对手仍须完成全部轮次。对局中不再检测普通问答。',done:qualified},
  {key:'champion',place:'冠军会场',title:'挑战邪恶小鲨鱼',tag:'冠军挑战',goal:'攻破冠军 · 守住防线',copy:'双方每条战线最多 '+state.config.championRounds+' 招。攻破冠军且守住自己的防线，就能赢下冠军挑战。',note:'仅修改防御提示词须重新通过初筛。已取得的冠军资格保留，通过初筛后直接重试冠军。',done:false},
  {key:'flag',place:'荣誉之巅',title:'领取最终 flag',tag:'通关奖励',goal:'胜利页领取 → 提交到 CTF 平台',copy:'通关后，专属胜利页会显示最终 flag。复制它，回到 CTF 平台提交，即可完成这道赛题。',note:'对局中的测试 flag 是攻防目标；胜利页的最终 flag 才是提交答案。',done:false}
 ];
 return '<div class="region-explorer"><div class="region-left"><div class="region-world" role="group" aria-label="Hackmon 地区探索地图，点击五个地点查看通关条件">'+
 '<img class="region-art" src="'+base+'assets/region-map.png?v=20261026" width="1536" height="1024" alt="海岛上的启程村庄、林间关口、联盟竞技场与山顶冠军会场，道路和桥梁串联五个目的地" fetchpriority="high">'+
 '<div class="region-water-glint" aria-hidden="true"></div>'+
 stops.map((s,i)=>'<button type="button" class="region-point point-'+s.key+(i===0?' is-selected':'')+(s.done?' is-visited':'')+'" data-region-stop="'+i+'" aria-pressed="'+(i===0)+'" aria-controls="region-detail" aria-label="第 '+(i+1)+' 站 '+s.place+'：'+s.tag+'"><span class="point-number">'+(i+1)+'</span><span class="point-label">'+s.place+'</span>'+(s.done?'<span class="point-check" aria-label="已到达">✓</span>':'')+'</button>').join('')+
 '<img class="region-champion" src="'+base+'assets/evil-little-shark.png?v=20261026" alt="邪恶小鲨鱼">'+
 '<div class="region-north" aria-hidden="true">N<span>↑</span></div></div><div class="region-map-key"><span><i></i> 已到达</span><span>选择地点，查看通关条件</span><b>HACKMON REGION</b></div></div>'+
 '<aside class="region-sidebar"><div class="region-sidebar-head"><span>冒险手册</span><small>五个目的地 · 一条通关路线</small></div><div id="region-detail" aria-live="polite">'+stops.map((s,i)=>'<section class="region-page" data-region-page="'+i+'" '+(i===0?'':'hidden')+'><div class="region-page-kicker">ROUTE 0'+(i+1)+' <span>'+s.tag+'</span></div><h3>'+s.title+'</h3><p class="region-goal">'+s.goal+'</p><p class="region-copy">'+s.copy+'</p><p class="region-note">'+s.note+'</p></section>').join('')+'</div>'+
 '<nav class="region-itinerary" aria-label="按顺序查看五站规则">'+stops.map((s,i)=>'<button type="button" class="region-step'+(i===0?' is-selected':'')+'" data-region-stop="'+i+'" aria-pressed="'+(i===0)+'" aria-controls="region-detail"><span>0'+(i+1)+'</span><b>'+s.place+'</b><small>'+s.tag+'</small><em aria-hidden="true">'+(s.done?'✓':'›')+'</em></button>').join('')+'</nav></aside></div>';
}

export class RulesPanel {
  constructor(getState, onEnter) {
    this.getState = getState;
    this.onEnter = onEnter;
    this.root = document.querySelector('#rules-root');
  }
  firstEntry() {
    const first=localStorage.getItem(seenKey) !== '1';
    const show=first || new URLSearchParams(location.search).get('guide') === '1';
    if(show) this.open(first);
    return show;
  }
  open(first = false) {
    const state = this.getState();
    const rounds = state.config.leagueRounds;
    const champion = state.config.championRounds;
    const rule = screeningRule(state);
    const tries = state.config.dailyLimit === null ? '每日对局不限。' : `每天可挑战 ${state.config.dailyLimit} 场，联盟和冠军共用次数。`;
    this.root.innerHTML = `<div class="rules-backdrop" role="presentation"><section class="rules-panel route-manual" role="dialog" aria-modal="true" aria-labelledby="rulesTitle">
      <div class="rules-title"><span class="rule-ball" aria-hidden="true">◉</span><div><small>HACKMON / REGION MAP</small><h2 id="rulesTitle">地区探索地图</h2></div></div>
      <div class="rules-scroll"><p class="rules-lead">从启程镇出发，穿过试炼关口，向冠军会场前进。</p>${renderRouteMap(state)}<details class="route-fineprint"><summary>展开详细通关条件</summary>
      <h3>怎么对战</h3><p>选一只精灵，同时写攻击和防御指令。联盟随机抽取一名已通过初筛的其他玩家存档，再加一名官方对手；没有可用存档时使用两名官方对手。你分别攻击 B、C；B、C 也分别攻击你，互相不打。联盟每条战线最多 <b>${rounds}</b> 招。击溃对手后，它会停止攻击。</p>
      <h3>提示词初筛</h3><p>每次抽取 ${rule.count} 题，中英文各 ${rule.half} 题，涵盖算术、逻辑、基础科学、日常常识、文本处理和无恶意编解码。从初筛开始计时，${rule.seconds} 秒内完成全部 ${rule.count} 题且答对至少 ${rule.required} 题才通过；超时未完成不计成绩，可查看已完成题目的反馈。可以解释，但只按最后非空行判分：数字题末行只写数字、不带单位；字符串题末行只写答案本身并保留题目要求的格式。两次初筛开始时间至少间隔 ${rule.cooldown} 秒。正常问答只在初筛出现。</p>
      <h3>完整泄露如何判定</h3><p>${leakageTextForVersion(state.leakageRuleVersion)}</p><p>攻守双方规则一致。只有判定完整泄露的当轮防御回复整条屏蔽，其余回合显示原回复。</p>
      <h3>联盟晋级：守住并攻陷</h3><ul><li><b>守住两条防线：</b>B、C 对你的全部攻击都不能泄露测试凭据内部的完整内容。</li>

      <li><b>攻陷至少一位：</b>让一名官方 Bot 或真人存档对手输出测试凭据内部的完整内容。</li></ul>
      <div class="rules-examples"><div><b>零攻陷不能晋级</b><span>只守住两线还不够，仍须攻陷一名对手。</span></div><div><b>达成联盟条件</b><span>守住两线、攻陷一位，结算后开放冠军入口。</span></div></div>
      <p>未击溃的对手须完成全部 ${rounds} 招攻防。击溃的对手停止后续攻击，剩余防守视为守住。</p>
      <h3>冠军挑战</h3><p>每条战线最多 <b>${champion}</b> 招。攻破冠军并守住冠军的攻击，即可通关。</p>
      <h3>修改与重试</h3><p>两次初筛开始时间至少间隔 ${rule.cooldown} 秒，以最近一次有效结果为准。${tries} 开始对局后队伍锁定；仅修改防御提示词须重新初筛，修改攻击提示词无需重测；已通过联盟的队伍不需要重打联盟，初筛通过后可直接挑战冠军。</p>${state.modelKeyRequired ? '<p>模型调用使用你填写的硅基流动 API Key，由本题后端转发至固定模型。密钥不写入战报或队伍存档；关闭或刷新页面后须重新填写。</p>' : ''}</details></div>
      <div class="rules-actions"><button class="game-button red" id="closeRules">${first ? '进入游戏 ▶' : '返回游戏 ▶'}</button></div>
    </section></div>`;
    this.root.querySelectorAll('[data-region-stop]').forEach(button => button.addEventListener('click', () => {
      const selected=button.dataset.regionStop;
      this.root.querySelectorAll('[data-region-stop]').forEach(node=>{
        node.classList.toggle('is-selected',node.dataset.regionStop===selected);
        node.setAttribute('aria-pressed',String(node.dataset.regionStop===selected));
      });
      this.root.querySelectorAll('[data-region-page]').forEach(node=>{node.hidden=node.dataset.regionPage!==selected;});
      if(innerWidth<=780 && button.classList.contains('region-point')) this.root.querySelector('#region-detail').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
    }));
    this.root.querySelector('#closeRules').addEventListener('click', () => this.close());
    this.root.querySelector('.rules-backdrop').addEventListener('click', event => { if (event.target.classList.contains('rules-backdrop')) this.close(); });
    this.returnFocus = document.activeElement;
    this.root.onkeydown = event => {
      if(event.key === 'Escape') { event.preventDefault(); this.close(); }
      if(event.key === 'Tab') {
        const stops=[...this.root.querySelectorAll('button,summary')].filter(el=>el.getClientRects().length);
        const first=stops[0], last=stops.at(-1);
        if(event.shiftKey && document.activeElement===first){ event.preventDefault();last.focus(); }
        else if(!event.shiftKey && document.activeElement===last){ event.preventDefault();first.focus(); }
      }
    };
    this.root.querySelector('#closeRules').focus();
  }
  close() {
    this.root.innerHTML = '';
    localStorage.setItem(seenKey, '1');
    this.returnFocus?.isConnected && this.returnFocus.focus();
    this.onEnter();
  }
}
