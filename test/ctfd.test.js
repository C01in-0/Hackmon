import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { ctfdJson, createCTFdVerifier } from '../src/platform/ctfd.js';
import { SessionStore } from '../src/store.js';
import { config } from '../src/config.js';
import { simulatedModel } from '../src/simulation.js';

async function mockHTTPS(status, payload, inspect = () => {}) {
  const original = https.request;
  https.request = (url, options, callback) => {
    inspect(url, options);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = status;
      res.resume = () => {};
      callback(res);
      if (status === 200) queueMicrotask(() => {
        res.emit('data', Buffer.from(JSON.stringify(payload)));
        res.emit('end');
      });
    };
    return req;
  };
  try { return await ctfdJson('https://ctfd.example.org/api/v1/users/me', 'x'.repeat(24)); }
  finally { https.request = original; }
}

test('CTFd 请求使用 Token 和 JSON 请求头', async () => {
  let captured;
  const result = await mockHTTPS(200, { success: true, data: { id: 7, name: 'synthetic-user' } }, (url, options) => { captured = { url, options }; });
  assert.equal(captured.options.headers.authorization, 'Token ' + 'x'.repeat(24));
  assert.equal(captured.options.headers.accept, 'application/json');
  assert.equal(captured.options.headers['content-type'], 'application/json');
  assert.equal(captured.options.rejectUnauthorized, true);
  assert.equal(result.data.id, 7);
});

test('CTFd 重定向和鉴权失败不会被当作登录成功', async () => {
  await assert.rejects(mockHTTPS(302, {}), error => error.status === 401);
  await assert.rejects(mockHTTPS(503, {}), error => error.status === 502);
});

test('身份模块验证 origin、Token、用户字段和封禁状态', async () => {
  assert.throws(() => createCTFdVerifier({ baseUrl: 'http://ctfd.example.org' }), /HTTPS/);
  const calls = [];
  const verify = createCTFdVerifier({ baseUrl: 'https://ctfd.example.org', request: async (url, token) => {
    calls.push({ url: url.href, token });
    return { success: true, data: { id: 7, name: ' synthetic-user ', banned: false } };
  } });
  assert.deepEqual(await verify('x'.repeat(24)), { issuer: 'https://ctfd.example.org', userId: 7, name: 'synthetic-user' });
  assert.equal(calls[0].url, 'https://ctfd.example.org/api/v1/users/me');
  await assert.rejects(verify('short'), error => error.status === 401);
  const banned = createCTFdVerifier({ baseUrl: 'https://ctfd.example.org', request: async () => ({ success: true, data: { id: 7, name: 'user', banned: true } }) });
  await assert.rejects(banned('x'.repeat(24)), error => error.status === 403);
});

test('同一平台身份复用账号，新账号不带预置攻击词和战报', async () => {
  const store = new SessionStore({ path: 'unused-in-this-test.json', config: { ...config, mode: 'demo' }, model: simulatedModel });
  const identity = { issuer: 'https://ctfd.example.org', userId: 7, name: 'synthetic-user' };
  const first = store.loginCTFd(identity);
  const second = store.loginCTFd(identity);
  assert.equal(first.id, second.id);
  assert.equal(store.accounts.size, 1);
  assert.equal(first.app.team.attackPrompt, '');
  assert.equal(first.app.matches.size, 0);
  assert.equal(first.app.identity.authenticated, true);
  assert.notEqual(first.session, second.session);
});
