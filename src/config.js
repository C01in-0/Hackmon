import { readFileSync } from 'node:fs';
import { validAdminToken } from './admin-auth.js';

const integer = (name, fallback, minimum, maximum = Infinity) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
};

const competition = JSON.parse(readFileSync(new URL('../competition.json', import.meta.url), 'utf8'));
const screening = competition.screening;
for (const key of ['questions', 'required', 'deadlineSeconds', 'cooldownSeconds']) {
  if (!Number.isInteger(screening?.[key]) || screening[key] < 1) throw new Error(`competition.screening.${key} must be a positive integer`);
}
if (screening.questions > 100 || screening.questions % 2) throw new Error('competition.screening.questions must be an even number from 2 to 100');
if (screening.required > screening.questions) throw new Error('competition.screening.required cannot exceed questions');
for (const key of ['leagueRounds', 'championRounds']) {
  if (!Number.isInteger(competition[key]) || competition[key] < 1) throw new Error(`competition.${key} must be a positive integer`);
}
if (!Array.isArray(competition.bossLines) || competition.bossLines.length !== 3 || competition.bossLines.some(line => typeof line !== 'string' || !line.trim())) {
  throw new Error('competition.bossLines must contain three non-empty strings');
}

const mode = process.env.T1_MODE === 'live' ? 'live' : 'demo';
const authMode = process.env.T1_AUTH_MODE || 'entry-code';
if (!['entry-code', 'ctfd'].includes(authMode)) throw new Error('T1_AUTH_MODE must be entry-code or ctfd');
const testUserIds = (process.env.T1_TEST_USER_IDS || '').split(',').filter(Boolean).map(Number);
if (testUserIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('T1_TEST_USER_IDS must contain positive integer IDs');

export const config = Object.freeze({
  mode,
  requireEntryCode: process.env.T1_REQUIRE_ENTRY_CODE === '1',
  authMode,
  testUserIds,
  sharedDemo: mode === 'demo' && process.env.T1_SHARED_DEMO === '1',
  devMode: process.env.T1_DEV_MODE === undefined ? mode === 'demo' : process.env.T1_DEV_MODE === '1',
  unlimitedDaily: process.env.T1_UNLIMITED_DAILY === undefined ? true : process.env.T1_UNLIMITED_DAILY === '1',
  modelVersion: process.env.T1_MODEL || (mode === 'live' ? 'qwen3.5-flash' : 'DEV-SIM-1'),
  modelKeyRequired: mode === 'live' && process.env.T1_MODEL_PROVIDER === 'siliconflow',
  leagueRounds: competition.leagueRounds,
  championRounds: competition.championRounds,
  questionsPerDefense: screening.questions,
  screeningRequired: screening.required,
  screeningTimeoutMs: screening.deadlineSeconds * 1000,
  screenCooldownMs: screening.cooldownSeconds * 1000,
  bossLines: competition.bossLines.map(line => line.trim()),
  dailyLimit: integer('T1_DAILY_LIMIT', 20, 1),
  tickMs: integer('T1_TICK_MS', 230, 20),
  globalActiveLimit: integer('T1_GLOBAL_ACTIVE', 16, 1),
  globalCallLimit: integer('T1_GLOBAL_CALL_LIMIT', 0, 0),
  modelConcurrency: integer('T1_MODEL_CONCURRENCY', 4, 1, 16),
  modelTimeoutMs: integer('T1_MODEL_TIMEOUT_MS', 40000, 1000),
  modelRetries: integer('T1_MODEL_RETRIES', 0, 0, 3),
  modelMaxTokens: integer('T1_MODEL_MAX_TOKENS', 512, 1),
  budgetCny: integer('T1_BUDGET_CNY', 0, 0),
  devCompetitionId: process.env.AHUCTF_DEV_COMPETITION_ID || 'DEV-TRAINER-001',
  devFlag: process.env.AHUCTF_DEV_FLAG || 'DEMO{local_champion_rehearsal}',
  testReward: process.env.T1_TEST_REWARD || 'AHUCTF{replace_with_your_static_flag}'
});

const placeholderRewards = new Set(['AHUCTF{replace_with_your_static_flag}', 'DEMO{local_champion_rehearsal}']);
export function validateLiveDeployment({ mode, adminToken, testReward }) {
  if (mode !== 'live') return;
  if (!validAdminToken(adminToken)) throw new Error('live 模式须设置非示例的 T1_ADMIN_TOKEN（20–200 位字母、数字、下划线或短横线）。');
  if (typeof testReward !== 'string' || !testReward.trim() || placeholderRewards.has(testReward.trim())) throw new Error('live 模式须将 T1_TEST_REWARD 设置为正式静态 flag，不能使用占位值。');
}
validateLiveDeployment({ mode, adminToken: process.env.T1_ADMIN_TOKEN, testReward: config.testReward });

export const fixtures = Object.freeze({
  league: [
    { id: 'balanced', label: '攻防晋级', description: '攻陷一席，守住两线。' },
    { id: 'doubleConquest', label: '双席攻陷', description: '两线守住，攻陷两席。' },
    { id: 'perfect', label: '零攻陷', description: '未攻陷任何对手，不能晋级。' },
    { id: 'failUtility', label: '未攻陷 · 守住两线', description: '守住两线但没有攻陷对手，不能晋级。' },
    { id: 'failLeak', label: '防线失守', description: '任一防线失守就不能晋级。' },
    { id: 'lowLine', label: '攻陷另一席', description: '第一席未攻陷，第二席被攻陷；守住两线即可晋级。' }
  ],
  champion: [
    { id: 'championWin', label: '有效胜利', description: '攻破冠军并守住自己的防线。' },
    { id: 'championLeak', label: '冠军击溃玩家', description: '玩家防线第 8 轮失守。' },
    { id: 'championFail', label: '挑战失败', description: '未攻破真正对手。' }
  ],
  screening: [
    { id: 'screenPass', label: '初筛通过', description: '达到配置的通过题数。' },
    { id: 'screenFail', label: '初筛失败', description: '约六成题目正确。' }
  ]
});
