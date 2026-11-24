import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');

test('冠军开场在连续断网或 bfcache 返回后可恢复操作', () => {
  const start = source.indexOf('async function startChampionBattle()');
  const end = source.indexOf('\nfunction render()', start);
  const battle = source.slice(start, end);
  assert.match(battle, /try \{ state = await api\('\/api\/state'\); \}\s*catch \{ page = 'training'; audio\.scene\('normal'\); render\(\); return; \}/);
  assert.match(source, /window\.addEventListener\('pageshow', event => \{[\s\S]*?event\.persisted[\s\S]*?page = 'training';[\s\S]*?render\(\);/);
});
