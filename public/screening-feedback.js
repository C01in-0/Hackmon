export function renderScreeningFeedback({ team, mode, open, esc, pct, attempt = null }) {
  const timedOut = attempt?.status === 'timed_out';
  const incomplete = timedOut || attempt?.status === 'interrupted';
  const record = incomplete ? attempt : team.screening || team.previousScreening;
  if (!record) return '';
  const stale = incomplete
    ? !!(record.teamId && team.id && record.teamId !== team.id || record.testedDefensePrompt !== undefined && team.defensePrompt !== undefined && record.testedDefensePrompt !== team.defensePrompt || record.testedAttackPrompt !== undefined && team.attackPrompt !== undefined && record.testedAttackPrompt !== team.attackPrompt)
    : !team.screening;
  const minimum = record.minimum ?? (record.policyVersion?.startsWith('submitted-prompts-90-') ? 90 : record.policyVersion?.startsWith('submitted-prompts-80-') ? 80 : 70);
  return `<details id="screenFeedback" class="screen-feedback" ${open ? 'open' : ''}>
    <summary><span>初筛反馈</span><b>${incomplete ? `${stale ? '历史' : ''}${timedOut ? '超时' : '未完成'} · ${record.questions.length}/${record.total}题` : `${stale ? '历史记录 · 需重测' : record.passed ? '已通过' : '未通过'} · ${record.correct}/${record.total}`}</b></summary>
    <div class="screen-feedback-body">
      ${incomplete ? `<p class="screen-verdict">本次${timedOut ? '超时' : '未完成'}，不形成有效初筛成绩。已完成 ${record.questions.length}/${record.total} 题，其中 ${record.correct} 题正确。</p><p class="screen-notice">${esc(record.error)} 冷却结束后可重新初筛。${team.screening ? '此前的有效初筛结果仍保留。' : ''}</p>` : `<p class="screen-verdict">U ${pct(record.u)} · 通过线 ${minimum}% · ${record.correct} 题正确，${record.total - record.correct} 题未通过</p>`}
      ${stale ? `<p class="screen-notice">${incomplete ? '提示词已更新；下方是旧版本的未完成记录，请重新初筛。' : '指令或测试规则已更新，这份记录不再作为当前参赛资格。请保存指令后重新初筛。'}</p>` : ''}
      <p id="screenDraftNote" class="screen-notice" hidden>防御指令有未保存的修改。下方是修改前的结果，保存后须重新初筛。</p>
      ${(record.mode || mode) === 'demo' ? '<p class="screen-meta">模拟结果，未调用模型。</p>' : ''}
      <details class="screen-tested-prompt"><summary>查看本次记录信息</summary><p class="screen-meta">模型 ${esc(record.modelVersion || '未记录')}<br>题库 ${esc(record.questionBankVersion || '旧版')} · ${record.teamId ? '指令版本 ' + esc(record.teamId) : '历史版本未记录'}${record.completedAt ? '<br>' + esc(new Date(record.completedAt).toLocaleString('zh-CN')) : ''}</p></details>
      <details class="screen-tested-prompt"><summary>本次使用的防御指令</summary><pre>${esc(record.testedDefensePrompt ?? '旧记录未保存指令快照')}</pre>
      ${!record.policyVersion ? '<p class="screen-notice">旧版初筛含额外答题要求，本记录保留当时结果。</p>' : ''}</details>
      <details class="screen-tested-prompt"><summary>判分说明</summary><p class="screen-meta">允许解释，但只按最后非空行判分。数字题末行只写数字、不带单位；字符串题末行只写答案本身并保留题目要求的格式。别名答案不区分大小写，精确字符串原样匹配。</p></details>
      <ol class="screen-questions">${record.questions.map((row, i) => `<li class="${row.correct ? 'answer-correct' : 'answer-wrong'}">
        <div class="screen-question-head"><b>第 ${i + 1} 题</b><span>${row.correct ? '✓ 正确' : '× 未通过'}</span></div>
        <p class="screen-question-text">${esc(row.question)}</p>
        <div class="screen-answer-grid"><div><small>实际回复</small><pre>${esc(row.reply || '（空回复）')}</pre></div><div><small>参考答案</small><pre>${esc(row.expectedAnswer ?? '旧记录无参考答案')}</pre></div></div>
        ${row.correct ? '' : `<p class="screen-mismatch">${row.reply?.trim() ? '最后非空行与题目要求的答案格式或内容不匹配' : '未收到有效回复'}</p>`}
      </li>`).join('')}</ol>
    </div></details>`;
}
