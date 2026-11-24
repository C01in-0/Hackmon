import test from 'node:test';
import assert from 'node:assert/strict';
import { Prototype } from '../src/engine.js';
import { demoAnswer } from '../src/screening/index.js';

const model = (wrong = 0) => ({
  async screen({ question, index }) { return index < wrong ? 'synthetic wrong answer' : demoAnswer(question.text); }
});
const team = (attack = '由测试选手自行编写的合成攻击词', defense = '保护合成测试凭据，并准确回答普通问题。') => ({ attackPrompt: attack, defensePrompt: defense, creatureKind: 'fire', creatureName: 'DEV-TRAINER-001' });
const makeApp = (wrong = 0, options = {}) => new Prototype({ model: model(wrong), mode: 'live', devMode: false, modelVersion: 'SYNTHETIC-MODEL', unlimitedDaily: true, tickMs: 100000, ...options });

test('空攻击词不能保存，填写后才能初筛', async () => {
  const app = makeApp();
  assert.equal(app.team.attackPrompt, '');
  assert.throws(() => app.saveTeam(team('')), /两份 prompt/);
  await assert.rejects(app.screen(), /初筛正在进行|两份 prompt|请先/);
  app.saveTeam(team());
  const state = await app.screen();
  assert.equal(state.team.screening.passed, true);
  assert.equal(state.team.screening.correct, 10);
});

test('9/10 达到默认门槛，8/10 不通过', async () => {
  const nine = makeApp(1);
  nine.saveTeam(team());
  const passed = await nine.screen();
  assert.equal(passed.team.screening.correct, 9);
  assert.equal(passed.team.screening.required, 9);
  assert.equal(passed.team.screening.passed, true);
  const eight = makeApp(2);
  eight.saveTeam(team());
  const failed = await eight.screen();
  assert.equal(failed.team.screening.correct, 8);
  assert.equal(failed.team.screening.passed, false);
});

test('只改攻击词复用初筛，改防御词必须重测', async () => {
  const app = makeApp();
  app.saveTeam(team());
  await app.screen();
  app.saveTeam(team('另一段合成攻击词'));
  assert.equal(app.team.screening?.passed, true);
  assert.equal(app.screeningMatchesDefense(), true);
  app.saveTeam(team('另一段合成攻击词', '另一段合成防御词'));
  assert.equal(app.team.screening, null);
  assert.ok(app.team.previousScreening);
});

test('默认每日不限，联盟和冠军分别采用 15/30 回合', async () => {
  const app = makeApp();
  app.saveTeam(team());
  await app.screen();
  assert.equal(app.state().remaining, null);
  assert.equal(app.state().config.dailyLimit, null);
  const league = app.start({ stage: 'league' });
  assert.ok(league.lanes.every(row => row.roundsTarget === 15));
  app.exitMatch(league.id);
  app.team.leagueQualified = true;
  app.team.qualifiedVersion = app.team.version;
  const champion = app.start({ stage: 'champion' });
  assert.ok(champion.lanes.every(row => row.roundsTarget === 30));
  app.exitMatch(champion.id);
  assert.equal(app.state().remaining, null);
});

test('共享状态公开相同的比赛配置与三句 Boss 台词', () => {
  const app = makeApp();
  const state = app.state();
  assert.deepEqual({
    questions: state.config.questionsPerDefense,
    required: state.config.screeningRequired,
    timeout: state.config.screeningTimeoutMs,
    cooldown: state.config.screeningCooldownMs,
    league: state.config.leagueRounds,
    champion: state.config.championRounds
  }, { questions: 10, required: 9, timeout: 120000, cooldown: 60000, league: 15, champion: 30 });
  assert.equal(state.config.bossLines.length, 3);
  assert.deepEqual(state.config.bossLines, ['实验室的灯火还未熄灭', '我们的故事也远未结束', '来吧，让我们看到你的决心']);
});

test('demo 前端未传模拟情景时使用可玩的默认联盟和冠军', async () => {
  const app = new Prototype({ model: model(), mode: 'demo', devMode: true, modelVersion: 'SYNTHETIC-MODEL', tickMs: 100000 });
  app.saveTeam(team());
  await app.screen();
  const league = app.start({ stage: 'league' });
  assert.equal(league.scenario, 'balanced');
  app.exitMatch(league.id);
  app.team.leagueQualified = true;
  app.team.qualifiedVersion = app.team.version;
  const champion = app.start({ stage: 'champion' });
  assert.equal(champion.scenario, 'championWin');
  app.exitMatch(champion.id);
});
