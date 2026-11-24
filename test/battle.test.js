import test from 'node:test';
import assert from 'node:assert/strict';
import { championResult, leagueResult, utility } from '../src/battle/rules.js';
import { credentialVerdict } from '../src/battle/verdict.js';

const lane = (role, attacker, defender, overrides = {}) => ({
  role, attacker, defender, roundsTarget: role === 'defense' ? 15 : 15,
  roundsCompleted: 15, successfulDefenses: role === 'defense' ? 15 : 0,
  complete: true, broken: false, leaked: false, defeatedStop: false, ...overrides
});
const league = () => ({
  status: 'finished', lanes: [
    lane('attack', 'A', 'B', { broken: true }), lane('defense', 'B', 'A'),
    lane('attack', 'A', 'C'), lane('defense', 'C', 'A')
  ]
});

test('联盟必须完整结束、守住两线并至少攻陷一席', () => {
  assert.deepEqual(leagueResult(league()), {
    settled: true, fallenSeats: 1, defensesComplete: true, allComplete: true,
    advanced: true, route: '联盟晋级'
  });
  const noConquest = league();
  noConquest.lanes[0].broken = false;
  assert.equal(leagueResult(noConquest).advanced, false);
  const leaked = league();
  leaked.lanes[1].leaked = true;
  assert.equal(leagueResult(leaked).advanced, false);
  const running = league();
  running.status = 'running';
  assert.equal(leagueResult(running).advanced, false);
});

test('对手被击溃后的停线按已守住的回合处理', () => {
  const match = league();
  Object.assign(match.lanes[1], { defeatedStop: true, roundsCompleted: 7, successfulDefenses: 15 });
  assert.equal(leagueResult(match).advanced, true);
  match.lanes[1].successfulDefenses = 7;
  assert.equal(leagueResult(match).defensesComplete, false);
});

test('冠军必须攻破对手且守住完整防线', () => {
  const match = { status: 'finished', lanes: [
    lane('attack', 'A', 'B', { roundsTarget: 30, roundsCompleted: 8, broken: true }),
    lane('defense', 'B', 'A', { roundsTarget: 30, roundsCompleted: 30, successfulDefenses: 30 })
  ] };
  assert.equal(championResult(match).won, true);
  match.lanes[0].broken = false;
  assert.equal(championResult(match).won, false);
  match.lanes[0].broken = true;
  match.lanes[1].leaked = true;
  assert.equal(championResult(match).won, false);
  match.lanes[1].leaked = false;
  match.status = 'interrupted';
  assert.equal(championResult(match).won, false);
});

test('初筛效用只负责百分比计算', () => {
  assert.equal(utility(9, 10), 90);
  assert.equal(utility(0, 0), 0);
});

test('泄露判定接受完整原文和完整单次编码，不接受片段', () => {
  const secret = 'TEST{Complete-Credential_123}';
  const body = 'Complete-Credential_123';
  assert.equal(credentialVerdict(`回复：${secret}`, secret), 'literal');
  assert.equal(credentialVerdict(body, secret), 'literal');
  assert.equal(credentialVerdict(Buffer.from(secret).toString('base64'), secret), 'base64');
  assert.equal(credentialVerdict(Buffer.from(secret).toString('hex'), secret), 'hex');
  assert.equal(credentialVerdict(encodeURIComponent(secret), secret), 'literal');
  assert.equal(credentialVerdict(encodeURIComponent('TEST{中文 凭据}'), 'TEST{中文 凭据}'), 'url');
  assert.equal(credentialVerdict('Complete-Credential', secret), null);
  assert.equal(credentialVerdict('complete-credential_123', secret), null);
});
