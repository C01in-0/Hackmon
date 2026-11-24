import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderRouteMap } from '../public/rules-panel.js';
import { renderBossScript } from '../public/battle-view.js';
import { productionAsset } from '../src/production-assets.js';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

test('页面规则读取同一份比赛配置', () => {
  const html = renderRouteMap({
    modelKeyRequired: false, identity: { displayName: 'synthetic' },
    team: { version: 1 }, config: {
      questionsPerDefense: 12, screeningRequired: 10,
      screeningTimeoutMs: 90000, screeningCooldownMs: 45000,
      leagueRounds: 18, championRounds: 36
    }
  });
  assert.match(html, /90秒内完成12题、答对至少10题 · 冷却45秒/);
  assert.match(html, /中英文各6题/);
  assert.match(html, /每条战线最多 18 招/);
  assert.match(html, /双方每条战线最多 36 招/);
});

test('Boss 三句织字由配置渲染并保持逐字结构', () => {
  const html = renderBossScript(escape, ['第一句', '第二句', '第三句']);
  assert.equal((html.match(/class="woven-line /g) || []).length, 3);
  assert.match(html, /第一句/);
  assert.match(html, /第三句/);
  assert.match(html, /data-letter="0"/);
});

test('开发浮窗保留原版样式，发布时完全移除', () => {
  const source = readFileSync(new URL('../public/finale.css', import.meta.url), 'utf8');
  for (const selector of ['#developer-root', '.dev-launch', '.dev-window', '.dev-content']) {
    assert.ok(source.includes(selector), `开发样式缺少 ${selector}`);
  }
  const production = productionAsset('/finale.css', source);
  assert.doesNotMatch(production, /#developer-root|\.dev-launch|\.dev-window|\.dev-content/);
});
