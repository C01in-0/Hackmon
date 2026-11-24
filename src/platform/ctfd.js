import https from 'node:https';

const fail = (message, status) => Object.assign(new Error(message), { status });
const invalid = () => fail('平台 Token 无效或已过期，请在比赛平台重新生成。', 401);

export function ctfdJson(url, token, { ca, servername, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const req = https.request(url, { method: 'GET', ca, servername, rejectUnauthorized: true,
      // CTFd only enters its API-token authentication path for JSON requests,
      // including GET /users/me; Accept alone falls back to cookie authentication.
      headers: { authorization: 'Token ' + token, accept: 'application/json', 'content-type': 'application/json' } }, res => {
      // Do not follow redirects: credentials must never leave the configured platform.
      if (res.statusCode !== 200) {
        res.resume();
        return finish([301, 302, 303, 307, 308, 401, 403].includes(res.statusCode) ? invalid() : fail('比赛平台暂时无法验证身份，请稍后重试。', 502));
      }
      let size = 0; const chunks = [];
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 65536) { finish(fail('比赛平台身份响应异常。', 502)); res.destroy(); return; }
        chunks.push(chunk);
      });
      res.on('error', () => finish(fail('比赛平台身份响应中断。', 502)));
      res.on('end', () => { try { finish(null, JSON.parse(Buffer.concat(chunks))); } catch { finish(fail('比赛平台身份响应异常。', 502)); } });
    });
    const timer = setTimeout(() => { finish(fail('比赛平台身份验证超时，请稍后重试。', 504)); req.destroy(); }, timeoutMs);
    req.on('error', () => finish(fail('无法安全连接比赛平台，请联系管理员。', 502)));
    req.end();
  });
}

export function createCTFdVerifier({ baseUrl, ca, servername, request = ctfdJson }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) throw new Error('CTFd 地址必须为固定 HTTPS origin。');
  const endpoint = new URL('/api/v1/users/me', base);
  let active = 0;
  return async raw => {
    const token = typeof raw === 'string' ? raw.trim() : '';
    if (!/^[A-Za-z0-9_-]{20,256}$/.test(token)) throw invalid();
    if (active >= 8) throw fail('身份验证繁忙，请稍后重试。', 429);
    active++;
    try {
      const value = await request(endpoint, token, { ca, servername });
      const user = value?.data;
      if (value?.success !== true || !Number.isSafeInteger(user?.id) || user.id <= 0 || typeof user.name !== 'string' || !user.name.trim() || user.name.length > 128) throw invalid();
      if (user.banned === true) throw fail('该平台账号已停用。', 403);
      return { issuer: base.origin, userId: user.id, name: user.name.trim() };
    } finally { active--; }
  };
}
