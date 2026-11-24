import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Prototype } from './engine.js';
import { roster as demoRoster } from './simulation.js';
import { adminDetail, issueEntry, loginEntry, loginCTFd, loginRequired } from './competition.js';

const publicId = id => createHash('sha256').update('public:' + id).digest('hex').slice(0,24);
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');

export class SessionStore {
  constructor({ path, config, model }) {
    this.path = resolve(path);
    this.config = config;
    this.model = model;
    this.accounts = new Map();
    this.gatewayUsed = 0;
    this.budget = {};
    this.sessions = new Map();
    this.recovery = new Map();
    this.entries = new Map();
    this.listeners = new Map();
    this.dirtyAccounts = new Set();
    this.persistScheduled = null;
    this.persistChain = Promise.resolve();
  }

  async load() {
    let saved;
    try {
      if (this.path.endsWith('.sqlite')) {
        await mkdir(dirname(this.path), {recursive:true});
        const { DatabaseSync } = await import('node:sqlite');
        this.db = new DatabaseSync(this.path);
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
        const metadata = this.db.prepare('SELECT value FROM metadata WHERE id=1').get();
        saved = metadata ? {...JSON.parse(metadata.value),accounts:Object.fromEntries(this.db.prepare('SELECT id,value FROM accounts').all().map(row=>[row.id,JSON.parse(row.value)]))} : JSON.parse(this.db.prepare('SELECT value FROM state WHERE id=1').get()?.value || '{}');
      } else saved = JSON.parse(await readFile(this.path, 'utf8'));
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; saved = {}; }
    this.gatewayUsed = saved.gatewayUsed || 0;
    this.budget = saved.budget || {};
    this.sessions = new Map(saved.sessions || []);
    this.recovery = new Map(saved.recovery || []);
    this.entries = new Map(saved.entries || []);
    for (const [id, data] of Object.entries(saved.accounts || {})) this.accounts.set(id, this.makeAccount(id, data));
    this.dirtyAccounts = new Set(this.accounts.keys());
    await this.persist(); // Store interrupted-on-restart matches before accepting requests.
    return this;
  }

  makeAccount(id, restored = null) {
    const entry = [...this.entries].find(([, value]) => value.accountId === id);
    return new Prototype({ ...this.config, model: this.model, mode: this.config.mode, modelVersion: this.config.modelVersion,
      requireNameBinding: true,
      onChange: () => { this.dirtyAccounts.add(id); for(const notify of this.listeners.get(id) || []) notify(); this.persist().catch(error => console.error('State save failed:', error)); },
      restored, identity: entry ? { competitionId: entry[0], source: entry[1].authType === 'ctfd' ? 'CTFd Token' : '平台 ID 与参赛码', authenticated: true,
        authType: entry[1].authType || 'entry-code', isTest: entry[1].authType === 'ctfd' && (this.config.testUserIds || []).includes(entry[1].platformUserId) }
        : { competitionId: `TEST-${publicId(id).toUpperCase()}`, source: '浏览器测试身份', authenticated: false },
      rosterProvider: () => this.config.mode === 'demo' ? [...demoRoster, ...this.roster(id)] : this.roster(id) });
  }

  roster(ownerId) {
    return [...this.accounts].filter(([id, app]) => id !== ownerId && !app.access.banned && !app.identity.isTest &&
      (!this.config.requireEntryCode || (app.identity.authenticated && (this.config.authMode !== 'ctfd' || app.identity.authType === 'ctfd'))) &&
      app.team.screening?.passed && app.team.screening.modelVersion === this.config.modelVersion)
      .map(([id, app]) => ({ id: publicId(id), name: app.testName || `测试选手 ${id.slice(0, 4).toUpperCase()}`, style: '真人离线存档', eligible: true,
        creatureKind: app.team.creatureKind, version: app.team.version,
        attackPrompt: app.team.attackPrompt, defensePrompt: app.team.defensePrompt }));
  }

  fromRequest(req, beforeCreate = () => {}) {
    const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)t1_session=([a-f0-9]{64})(?:;|$)/);
    const accountId = cookie && (this.sessions.get(cookie[1]) || (!this.config.requireEntryCode && cookie[1]));
    const existing = accountId && this.accounts.get(accountId);
    if (existing && (!this.config.requireEntryCode || (existing.identity.authenticated && (this.config.authMode !== 'ctfd' || existing.identity.authType === 'ctfd')))) return { id: accountId, session: cookie[1], app: existing, isNew: false };
    if (this.config.requireEntryCode) throw loginRequired();
    beforeCreate();
    if (this.accounts.size >= 500) throw new Error('测试名额已满。');
    const id = token();
    const app = this.makeAccount(id);
    this.accounts.set(id, app); this.dirtyAccounts.add(id);
    this.persist().catch(error => console.error('State save failed:', error));
    const session = token(); this.sessions.set(session,id);
    return { id, session, app, isNew: true };
  }

  issueRecovery(id) {
    if (this.config.requireEntryCode) throw Object.assign(new Error('正式参赛请重新验证比赛平台身份。'), {status:403});
    for (const [hash, owner] of this.recovery) if (owner === id) this.recovery.delete(hash);
    const code = token(); this.recovery.set(digest(code), id); return code;
  }
  restartDeveloperEntry(id) {
    const original = this.accounts.get(id);
    original?.assertAccess();
    if (!original?.canUseDeveloperTools()) throw Object.assign(new Error('开发控制不可用。'), {status:403});
    if (original.activeMatchId || original.screeningInProgress) throw new Error('请等待当前对局或初筛结束后回到首次界面。');
    const fresh = this.fromRequest({headers:{}});
    // Preserve existing recovery codes and all old matches/instructions.
    const returnCode = token(); this.recovery.set(digest(returnCode), id);
    return { ...fresh, returnCode };
  }
  recover(code) {
    if (this.config.requireEntryCode) throw loginRequired();
    if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) throw new Error('恢复码无效。');
    const id = this.recovery.get(digest(code)); const app = this.accounts.get(id);
    if (!app || app.access.banned) throw new Error('恢复码无效或账号已停用。');
    const session = token(); this.sessions.set(session,id); return {id,session,app};
  }
  adminList() {
    return [...this.accounts].map(([id,app]) => ({ id: publicId(id), name: app.testName,
      authenticated: app.identity.authenticated, isTest: !!app.identity.isTest, platformId: app.identity.authenticated ? app.identity.competitionId : null,
      banned: app.access.banned, matches: app.matches.size, active: !!app.activeMatchId,
      screeningPassed: !!app.team.screening?.passed, cleared: [...app.matches.values()].some(m => m.stage === 'champion' && m.status === 'finished' && m.result?.won) }));
  }
  publicAccountId(id) { return publicId(id); }
  issueEntry(id, rotate = false) { return issueEntry(this, id, rotate); }
  loginEntry(id, code) { return loginEntry(this, id, code); }
  loginCTFd(identity) { return loginCTFd(this, identity); }
  adminDetail(id) { return adminDetail(this, id); }
  adminReport(id, matchId) {
    const account = [...this.accounts].find(([key]) => publicId(key) === id)?.[1];
    if (!account) throw Object.assign(new Error('账号不存在。'), {status:404});
    return account.report(matchId);
  }
  ban(publicAccountId, banned) {
    const entry = [...this.accounts].find(([id]) => publicId(id) === publicAccountId);
    if (!entry) throw new Error('账号不存在。');
    const app = entry[1]; app.access.banned = banned;
    if (banned) {
      app.screenController?.abort();
      for (const match of app.matches.values()) if(match.status === 'running') app.interrupt(match,new Error('账号已停用'));
    }
    app.onChange();
  }
  subscribe(id, listener) {
    const set = this.listeners.get(id) || new Set();
    if (set.size >= 4) throw new Error('连接过多，请关闭重复页面。');
    set.add(listener); this.listeners.set(id,set);
    return () => { set.delete(listener); if(!set.size) this.listeners.delete(id); };
  }

  activeCount() {
    return [...this.accounts.values()].filter(app => app.activeMatchId).length;
  }

  persist() {
    // Coalesce same-turn changes; SQLite rewrites only the changed account, not
    // every player's entire history for each model request or phase change.
    if(this.persistScheduled) return this.persistScheduled;
    this.persistScheduled = this.persistChain.catch(() => {}).then(async () => {
      this.persistScheduled = null;
      const metadata = {version:4,gatewayUsed:this.gatewayUsed,budget:this.budget,sessions:[...this.sessions],recovery:[...this.recovery],entries:[...this.entries]};
      if(this.db) {
        const ids=[...this.dirtyAccounts];
        this.db.exec('BEGIN IMMEDIATE');
        try {
          const upsert=this.db.prepare('INSERT INTO accounts(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value');
          for(const id of ids) upsert.run(id,JSON.stringify(this.accounts.get(id).serialize()));
          this.db.prepare('INSERT INTO metadata(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(metadata));
          this.db.exec('DELETE FROM state; COMMIT');
          for(const id of ids)this.dirtyAccounts.delete(id);
        }catch(error){this.db.exec('ROLLBACK');throw error;}
        return;
      }
      const snapshot=JSON.stringify({...metadata,accounts:Object.fromEntries([...this.accounts].map(([id,app])=>[id,app.serialize()]))});
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = this.path + '.tmp';
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, this.path);
    });
    this.persistChain = this.persistScheduled;
    return this.persistChain;
  }
}
