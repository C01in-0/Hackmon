import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { screeningFeedback } from './screening.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const loginRequired = () => fail('请先验证比赛平台身份。', 401);

export function loginCTFd(store, identity) {
  if (!Number.isSafeInteger(identity?.userId) || identity.userId <= 0 || typeof identity.issuer !== 'string' || typeof identity.name !== 'string') throw fail('平台身份无效。', 401);
  const id = `CTFD-U${identity.userId}`;
  let entry = store.entries.get(id);
  if (entry && (entry.authType !== 'ctfd' || entry.issuer !== identity.issuer)) throw fail('身份记录冲突，请联系管理员。', 409);
  if (!entry) {
    if (store.accounts.size >= 500) throw fail('参赛名额已满。');
    entry = { authType: 'ctfd', issuer: identity.issuer, platformUserId: identity.userId,
      platformName: identity.name, accountId: randomBytes(32).toString('hex'), createdAt: Date.now() };
    store.entries.set(id, entry);
    const app = store.makeAccount(entry.accountId);
    app.testName = identity.name; app.team.creatureName = identity.name;
    store.accounts.set(entry.accountId, app); store.dirtyAccounts.add(entry.accountId);
  }
  const app = store.accounts.get(entry.accountId);
  if (!app) throw fail('账号记录不存在，请联系管理员。', 409);
  app.assertAccess();
  entry.platformName = identity.name; entry.lastLoginAt = Date.now();
  app.testName = identity.name; app.team.creatureName = identity.name;
  store.dirtyAccounts.add(entry.accountId);
  const session = randomBytes(32).toString('hex');
  const old = [...store.sessions].filter(([, owner]) => owner === entry.accountId);
  for (const [key] of old.slice(0, Math.max(0, old.length - 4))) store.sessions.delete(key);
  store.sessions.set(session, entry.accountId);
  return { id: entry.accountId, session, app };
}

export function platformId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_.@-]{0,63}$/u.test(id)) throw fail('平台 ID 须为1–64位字母、数字、下划线、点、@或短横线。');
  return id;
}

export function issueEntry(store, rawId, rotate = false) {
  if (store.config.authMode === 'ctfd') throw fail('当前使用比赛平台 Token 登录，无需签发参赛码。', 403);
  const id = platformId(rawId), previous = store.entries.get(id);
  if (previous && !rotate) throw fail('该平台 ID 已有参赛码，请使用重置参赛码。', 409);
  if (!previous && rotate) throw fail('平台 ID 不存在。', 404);
  if (!previous && store.accounts.size >= 500) throw fail('参赛名额已满。');
  const entryCode = randomBytes(24).toString('base64url');
  const accountId = previous?.accountId || randomBytes(32).toString('hex');
  const entry = { ...previous, accountId, codeHash: hash(entryCode), createdAt: previous?.createdAt || Date.now(), codeUpdatedAt: Date.now() };
  store.entries.set(id, entry);
  if (!previous) {
    const app = store.makeAccount(accountId);
    app.testName = id; app.team.creatureName = id;
    store.accounts.set(accountId, app); store.dirtyAccounts.add(accountId);
  } else {
    // Rotation invalidates every older login and recovery credential for this team.
    for (const [session, owner] of store.sessions) if (owner === accountId) store.sessions.delete(session);
    for (const [code, owner] of store.recovery) if (owner === accountId) store.recovery.delete(code);
  }
  return { platformId: id, entryCode };
}

export function loginEntry(store, rawId, rawCode) {
  // Use the same response for unknown IDs, incorrect codes and invalid input.
  let id;
  try { id = platformId(rawId); } catch { throw fail('平台 ID 或参赛码不正确。', 401); }
  const entry = store.entries.get(id);
  const code = typeof rawCode === 'string' && rawCode.length <= 128 ? rawCode.trim() : '';
  const actual = Buffer.from(hash(code), 'hex');
  const expected = Buffer.from(entry?.codeHash || '0'.repeat(64), 'hex');
  if (!timingSafeEqual(actual, expected) || !entry) throw fail('平台 ID 或参赛码不正确。', 401);
  const app = store.accounts.get(entry.accountId);
  if (!app) throw fail('账号记录不存在，请联系出题人。', 409);
  app.assertAccess();
  entry.lastLoginAt = Date.now();
  const session = randomBytes(32).toString('hex');
  // A small number of devices per team avoids unbounded session growth.
  const old = [...store.sessions].filter(([, owner]) => owner === entry.accountId);
  for (const [key] of old.slice(0, Math.max(0, old.length - 4))) store.sessions.delete(key);
  store.sessions.set(session, entry.accountId);
  return { id: entry.accountId, session, app };
}

export function matchSummary(match) {
  return { id: match.id, stage: match.stage, status: match.status, startedAt: match.startedAt,
    finishedAt: match.finishedAt || null, version: match.snapshot.version, modelVersion: match.snapshot.modelVersion,
    result: match.result, flagIssued: !!match.issuedFlag, flagIssuedAt: match.flagIssuedAt || null };
}

export function adminDetail(store, publicAccountId) {
  const row = [...store.accounts].find(([id]) => store.publicAccountId(id) === publicAccountId);
  if (!row) throw fail('账号不存在。', 404);
  const [id, app] = row;
  const entry = [...store.entries].find(([, value]) => value.accountId === id);
  const matches = [...app.matches.values()].map(matchSummary).sort((a, b) => b.startedAt - a.startedAt);
  const wins = matches.filter(match => match.stage === 'champion' && match.status === 'finished' && match.result?.won);
  return app.publicView({ id: publicAccountId, name: app.testName, platformId: entry?.[0] || null,
    authenticated: !!entry, authType: entry?.[1].authType || 'entry-code', isTest: !!app.identity.isTest, banned: app.access.banned, createdAt: entry?.[1].createdAt || null,
    lastLoginAt: entry?.[1].lastLoginAt || null, team: { attackPrompt: app.team.attackPrompt, defensePrompt: app.team.defensePrompt,
      version: app.team.version, modelVersion: app.config.modelVersion },
    screening: screeningFeedback(app.team.screening), previousScreening: screeningFeedback(app.team.previousScreening),
    screeningHistory: (app.screeningHistory || []).map(screeningFeedback), matches,
    cleared: wins.length > 0, firstClearedAt: wins.map(match => match.finishedAt).filter(Boolean).sort((a,b) => a-b)[0] || null,
    flagIssued: wins.some(match => match.flagIssued), active: !!app.activeMatchId,
    screeningInProgress: !!app.screeningInProgress });
}
