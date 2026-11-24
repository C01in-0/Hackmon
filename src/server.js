import http from 'node:http';
import { matchesAdminToken } from './admin-auth.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { config } from './config.js';
import { simulatedModel } from './simulation.js';
import { ModelGateway, liveModel } from './live-model.js';
import { SessionStore } from './store.js';
import { sendMedia } from './media-response.js';
import { productionAsset } from './production-assets.js';
import { createCTFdVerifier } from './platform/ctfd.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
if (config.authMode === 'ctfd' && !config.requireEntryCode) throw new Error('CTFd 身份模式必须启用正式登录。');
const ctfdBase = process.env.T1_CTFD_ORIGIN;
const verifyCTFd = config.authMode === 'ctfd' ? createCTFdVerifier({ baseUrl: ctfdBase,
  ca: process.env.T1_CTFD_CA_FILE ? await readFile(process.env.T1_CTFD_CA_FILE) : undefined,
  servername: process.env.T1_CTFD_SERVERNAME || undefined }) : null;
const localPreview = config.devMode && process.env.T1_LOCAL_PREVIEW === '1' && ['127.0.0.1', 'localhost'].includes(process.env.HOST || '127.0.0.1');
const store = await new SessionStore({ path: process.env.T1_DATA_FILE || join(root, 'data', config.mode === 'live' ? 'hackmon.sqlite' : 'state.json'), config: { ...config, localPreview }, model: simulatedModel }).load();
let gateway;
if (config.mode === 'live') {
  const initialSpend=Number(process.env.T1_INITIAL_SPEND_CNY || 0);
  if(!Number.isFinite(initialSpend)||initialSpend<0)throw new Error('初始预算用量无效');
  store.budget.spent=(store.budget.spent||0)+Math.max(0,initialSpend-(store.budget.initialSpend||0));
  store.budget.initialSpend=Math.max(initialSpend,store.budget.initialSpend||0);
  gateway = new ModelGateway({ baseUrl: process.env.T1_MODEL_API_BASE, apiKey: process.env.T1_MODEL_API_KEY,
    provider: process.env.T1_MODEL_PROVIDER || 'aliyun',
    model: process.env.T1_MODEL, concurrency: config.modelConcurrency, callLimit: config.globalCallLimit,
    timeoutMs: config.modelTimeoutMs, maxTokens: config.modelMaxTokens, retries: config.modelRetries, used: store.gatewayUsed,
    budget: store.budget, budgetCny: config.budgetCny,
    onChange: () => { store.gatewayUsed = gateway.used; store.budget = gateway.budget; return store.persist(); } });
  store.model = liveModel(gateway);
  for (const app of store.accounts.values()) app.model = store.model;
}
const basePath = (process.env.T1_BASE_PATH || '').replace(/\/$/, '');
if (basePath && !/^\/[a-z0-9-]+$/.test(basePath)) throw new Error('T1_BASE_PATH 无效。');
const rates = new Map();
function rateLimit(req, kind, limit, duration) {
  const key = (process.env.T1_PROXY_TOKEN && req.headers['x-hackmon-client-ip'] || req.socket.remoteAddress || 'unknown') + ':' + kind, now = Date.now();
  if (rates.size > 10000) for(const [key,value] of rates) if(value.until < now) rates.delete(key);
  let value = rates.get(key); if(!value || value.until < now) { value={count:0,until:now+duration}; rates.set(key,value); }
  if(++value.count > limit) throw Object.assign(new Error('请求过于频繁，请稍后重试。'),{status:429});
}
function cookie(res, session) { res.setHeader('set-cookie', `t1_session=${session}; Path=${basePath || '/'}; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.T1_COOKIE_SECURE === '1' ? '; Secure' : ''}`); }
function admin(req) {
  const expected=process.env.T1_ADMIN_TOKEN || '', actual=(req.headers.authorization || '').replace(/^Bearer /,'');
  if(!matchesAdminToken(expected,actual)) throw Object.assign(new Error('无管理权限。'),{status:403});
}
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
if (config.sharedDemo && (!process.env.T1_DATA_FILE || !/^https:\/\/[^/]+$/.test(process.env.T1_PUBLIC_ORIGIN || ''))) throw new Error('模拟试玩须使用独立存档并配置 HTTPS 公开入口。');
if (host !== '127.0.0.1' && host !== 'localhost' && config.mode !== 'live' && !config.sharedDemo) throw new Error('公开监听须使用 live 模式或明确开启独立模拟试玩。');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };

function send(res, status, data, type = 'application/json; charset=utf-8', cacheControl = 'no-store') {
  const payload = type.startsWith('application/json') ? JSON.stringify(data) : data;
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(payload), 'cache-control': cacheControl,
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'" });
  res.end(payload);
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) throw new Error('请求内容过长。');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('请求 JSON 无效。'); }
}

const server = http.createServer(async (req, res) => {
  try {
    const proxySecret=process.env.T1_PROXY_TOKEN;
    if(proxySecret && req.headers['x-hackmon-proxy-token'] !== proxySecret && req.url !== '/healthz') return send(res,403,{error:'入口无效。'});
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (basePath) {
      if (url.pathname === basePath) { res.writeHead(308,{location:basePath+'/'}); return res.end(); }
      if (!url.pathname.startsWith(basePath+'/') && url.pathname !== '/healthz') return send(res,404,{error:'文件不存在。'});
      if(url.pathname.startsWith(basePath+'/')) url.pathname = url.pathname.slice(basePath.length);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      const expected = process.env.T1_PUBLIC_ORIGIN || 'http://' + req.headers.host;
      if ((origin && origin !== expected) || req.headers['sec-fetch-site'] === 'cross-site') return send(res,403,{error:'请求来源无效。'});
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true, mode: config.mode });
    if (!config.devMode && (url.searchParams.has('preview') || url.pathname === '/developer-panel.js' || /^\/api\/developer(?:\/|$)/.test(url.pathname))) {
      return send(res, 404, { error: '接口或文件不存在。' });
    }
    if (url.pathname.startsWith('/api/')) {
      rateLimit(req,'api',1200,60000);
      if (req.method === 'GET' && url.pathname === '/api/auth-config') return send(res,200,{ mode: config.authMode,
        platformSettingsUrl: verifyCTFd ? new URL('/settings#tokens',ctfdBase).href : null, modelKeyRequired: config.modelKeyRequired });
      if (url.pathname.startsWith('/api/admin/')) {
        admin(req);
        if (req.method === 'GET' && url.pathname === '/api/admin/status') return send(res,200,{authMode:config.authMode,budget:gateway?.stats() || null,accounts:store.adminList(),active:store.activeCount(),memoryMb:Math.round(process.memoryUsage().rss/1048576)});
        if (req.method === 'POST' && url.pathname === '/api/admin/entries') {
          const value=await body(req);
          const entry=store.issueEntry(value.platformId, value.rotate === true);
          await store.persist(); return send(res,200,entry);
        }
        const accountReport=url.pathname.match(/^\/api\/admin\/accounts\/([a-f0-9]{24})\/matches\/([a-f0-9-]+)$/);
        if(req.method === 'GET' && accountReport) return send(res,200,store.adminReport(accountReport[1],accountReport[2]));
        const account=url.pathname.match(/^\/api\/admin\/accounts\/([a-f0-9]{24})$/);
        if(req.method === 'GET' && account) return send(res,200,store.adminDetail(account[1]));
        if (req.method === 'POST' && url.pathname === '/api/admin/ban') {
          const value=await body(req); if(typeof value.banned !== 'boolean') throw new Error('封禁状态无效。');
          store.ban(value.id,value.banned); await store.persist(); return send(res,200,{ok:true});
        }
        return send(res,404,{error:'接口不存在。'});
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        rateLimit(req,'login',60,60000);
        const value=await body(req), loggedIn=verifyCTFd ? store.loginCTFd(await verifyCTFd(value.platformToken)) : store.loginEntry(value.platformId,value.entryCode);
        await store.persist(); cookie(res,loggedIn.session); return send(res,200,loggedIn.app.state());
      }
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        const session=(req.headers.cookie || '').match(/(?:^|;\s*)t1_session=([a-f0-9]{64})(?:;|$)/)?.[1];
        if(session) store.sessions.delete(session);
        await store.persist();
        res.setHeader('set-cookie',`t1_session=; Path=${basePath || '/'}; HttpOnly; SameSite=Lax; Max-Age=0${process.env.T1_COOKIE_SECURE === '1' ? '; Secure' : ''}`);
        return send(res,200,{ok:true});
      }
      if(req.method === 'POST' && url.pathname === '/api/recover') {
        rateLimit(req,'recover',20,3600000);
        const restored = store.recover((await body(req)).code); cookie(res,restored.session); await store.persist(); return send(res,200,restored.app.state());
      }
      const { app, isNew, id, session } = store.fromRequest(req, () => rateLimit(req,'new',30,3600000));
      if (isNew) { cookie(res,session); await store.persist(); }
      if (app.access.banned) return send(res, 403, { error: '此账号已停用。' });
      if (req.method === 'POST' && url.pathname === '/api/recovery-code') { const code=store.issueRecovery(id); await store.persist(); return send(res,200,{code}); }
      const report = url.pathname.match(/^\/api\/matches\/([a-f0-9-]+)\/report$/);
      if(req.method === 'GET' && report) return send(res,200,app.report(report[1]));
      const stream = url.pathname.match(/^\/api\/matches\/([a-f0-9-]+)\/events$/);
      if(req.method === 'GET' && stream) {
        app.getMatch(stream[1]);
        let scheduled = null, closed=false;
        const notify=()=> { if(!scheduled && !closed) scheduled=setTimeout(()=> {scheduled=null; push();},80); };
        const unsubscribe=store.subscribe(id,notify);
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no','connection':'keep-alive'});
        const push=()=> {
          if(closed) return;
          if(app.access.banned) return res.end();
          if(config.requireEntryCode && store.sessions.get(session)!==id) return res.end();
          const value=app.getMatch(stream[1]);
          if(res.writableLength > 1024*1024) return res.end();
          res.write('data: '+JSON.stringify(value)+'\n\n');
          if(value.status !== 'running') res.end();
        };
        const heartbeat=setInterval(()=> {if(!closed)res.write(': heartbeat\n\n');},15000);
        res.on('close',()=> {closed=true;clearInterval(heartbeat);clearTimeout(scheduled);unsubscribe();});
        push(); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, app.state());
      if (req.method === 'POST' && url.pathname === '/api/developer') { const value = app.updateDeveloperSettings(await body(req)); await store.persist(); return send(res, 200, value); }
      if (req.method === 'POST' && url.pathname === '/api/developer/reset-screen') { const value = app.resetScreening(); await store.persist(); return send(res, 200, value); }
      if (req.method === 'POST' && url.pathname === '/api/developer/reset-intro') { const value = app.resetChampionIntro(); await store.persist(); return send(res, 200, value); }
      if (req.method === 'POST' && url.pathname === '/api/developer/reset-entry') {
        const fresh = store.restartDeveloperEntry(id); await store.persist(); cookie(res,fresh.session);
        return send(res,200,{returnCode:fresh.returnCode});
      }
      if (req.method === 'POST' && url.pathname === '/api/identity') { const value = app.bindTestName((await body(req)).name); await store.persist(); return send(res, 200, value); }
      if (req.method === 'POST' && url.pathname === '/api/team') { const value = app.saveTeam(await body(req)); await store.persist(); return send(res, 200, value); }
      if (req.method === 'POST' && url.pathname === '/api/screen') { const request = await body(req); const value = await app.screen(request.scenario, request.apiKey); await store.persist(); return send(res, 200, value); }
      if (req.method === 'POST' && url.pathname === '/api/matches') {
        const request = await body(req);
        const repeated = request.requestId && [...app.matches.values()].some(match => match.requestId === request.requestId);
        if (!repeated && store.activeCount() >= config.globalActiveLimit) throw new Error('当前对局已满，请稍后再试。');
        const value = app.start(request); await store.persist(); return send(res, 200, value);
      }
      const exitMatch = url.pathname.match(/^\/api\/matches\/([a-f0-9-]+)\/exit$/);
      if (req.method === 'POST' && exitMatch) {
        const value = app.exitMatch(exitMatch[1]); await store.persist(); return send(res, 200, value);
      }
      const match = url.pathname.match(/^\/api\/matches\/([a-f0-9-]+)$/);
      if (req.method === 'GET' && match) { const value = app.getMatch(match[1]); if (value.status !== 'running') await store.persist(); return send(res, 200, value); }
      return send(res, 404, { error: '接口不存在。' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 404, { error: '接口不存在。' });
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!['/index.html', '/game.css', '/boss.css', '/revision.css', '/game.js', '/screening-feedback.js', '/battle-view.js', '/audio.js', '/fx.js', '/intro.js', '/rules-panel.js', '/polish.css', '/playback.js', '/motion.css', '/finale.css', '/finale.js', '/portraits.js', '/battle-ambient.js', '/defeat.js', '/round-two.css', '/developer-panel.js', '/paths.js', '/report.js', '/hackmon.css', '/admin.html', '/admin.js'].includes(pathname) && !/^\/assets\/(?:[a-z-]+\.(?:png|webp)|author-(?:[1-9]|1[0-9]|2[01])\.(?:png|jpg|webp))$/.test(pathname) && !/^\/audio\/[a-z-]+\.(?:wav|ogg)$/.test(pathname)) return send(res, 404, { error: '文件不存在。' });
    // Preserve existing image URLs in CSS, portraits and old replays. Release
    // builds contain the WebP copies, not the large original masters.
    if (pathname.startsWith('/assets/')) {
      const compactPath = pathname.replace(/\.(png|jpg)$/, '.webp');
      try {
        const compact = await readFile(join(root, 'public', compactPath.slice(1)));
        return sendMedia(req, res, compact, 'image/webp');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (pathname.startsWith('/audio/')) {
      return sendMedia(req, res, await readFile(join(root, 'public', pathname.slice(1))), types[extname(pathname)]);
    }
    if (config.sharedDemo && /^\/assets\//.test(pathname)) {
      const compactPath = pathname.replace(/\.(png|jpg)$/, '.webp').replace(/\.wav$/, '.ogg');
      try {
        const compact = await readFile(join(here, 'data/shared-demo/optimized', compactPath.slice(1)));
        return sendMedia(req, res, compact, compactPath.endsWith('.webp') ? 'image/webp' : 'audio/ogg');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let file = await readFile(join(root, 'public', pathname.slice(1)));
    if (!config.devMode && /\.(?:js|css)$/.test(pathname)) file = productionAsset(pathname, file);
    if (config.sharedDemo && pathname === '/index.html') file = file.toString().replace('<html lang="zh-CN">', '<html lang="zh-CN" data-shared-demo="1">');
    return send(res, 200, file, types[extname(pathname)]);
  } catch (error) {
    if (res.headersSent) return res.end();
    if(error.retryAfter) res.setHeader('retry-after', String(error.retryAfter));
    return send(res, error.status || 400, { error: error.message || '请求失败。' });
  }
});

server.listen(port, host, () => console.log(`Hackmon ${config.mode}: http://${host}:${server.address().port}${basePath}/`));
