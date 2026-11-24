import { setTimeout as delay } from 'node:timers/promises';
import { SILICONFLOW_FREE_CANDIDATES } from './siliconflow-models.js';

// Prices deliberately use the peak, cache-miss tariff. The ledger is an upper
// estimate, not a provider invoice. Unknown/aborted calls retain their reserve.
export class ModelGateway {
  constructor({ baseUrl, apiKey, model, provider = 'deepseek', concurrency = 4, callLimit = 20000, timeoutMs = 40000,
    maxTokens = 256, used = 0, budget = {}, budgetCny = 50, inputRate, outputRate,
    onChange = () => {}, retries = 1 }) {
    if (!baseUrl || !model || (provider !== 'siliconflow' && !apiKey)) throw new Error('live 模式须配置模型地址、模型名及所需密钥。');
    if (!['deepseek', 'aliyun', 'siliconflow'].includes(provider)) throw new Error('T1_MODEL_PROVIDER 仅支持 deepseek、aliyun 或 siliconflow。');
    if (provider === 'siliconflow' && !SILICONFLOW_FREE_CANDIDATES.includes(model))
      throw new Error('硅基流动入口只允许已明确标为 Free 的候选型号；不能以目录中的 0 值字段认定免费。');
    const aliyunRates = {
      'qwen-flash': { inputRate: .15, outputRate: 1.5 },
      'qwen-flash-2025-07-28': { inputRate: .15, outputRate: 1.5 },
      // Beijing, input <=128K; the 64KB request limit below keeps this tariff applicable.
      // https://help.aliyun.com/en/model-studio/qwen3-5-flash (2026-10-26)
      'qwen3.5-flash': { inputRate: .2, outputRate: 2 },
      'qwen3.5-flash-2026-02-23': { inputRate: .2, outputRate: 2 }
    };
    if (provider === 'aliyun' && !Object.hasOwn(aliyunRates, model))
      throw new Error('阿里云型号尚未配置计费估算，请先核对模型与地域费率。');
    if (!Number.isFinite(budgetCny) || budgetCny < 0) throw new Error('模型预算须为非负数，0表示不设上限。');
    const rates = provider === 'aliyun' ? aliyunRates[model] : provider === 'siliconflow'
      ? { inputRate: 0, outputRate: 0 } : { inputRate: 2, outputRate: 8 };
    Object.assign(this, { model, provider, concurrency, callLimit, timeoutMs, maxTokens, used, onChange, retries,
      inputRate: inputRate ?? rates.inputRate, outputRate: outputRate ?? rates.outputRate });
    this.url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    this.key = apiKey; this.active = 0; this.queue = [];
    this.budget = { spent: 0, inputTokens: 0, outputTokens: 0, uncertain: 0, ...budget, limit: budgetCny === 0 ? null : budgetCny };
  }
  stats() { return { ...this.budget, calls: this.used, active: this.active, queued: this.queue.length }; }
  async acquire(signal, phase) {
    signal?.throwIfAborted();
    if (this.active < this.concurrency) { this.active++; return; }
    if (this.queue.length >= 128) throw new Error('模型队列已满，请稍后重试。');
    phase?.('queued');
    await new Promise((resolve, reject) => {
      const entry = { resolve: () => { signal?.removeEventListener('abort', cancel); resolve(); }, signal };
      const cancel = () => { this.queue = this.queue.filter(item => item !== entry); reject(signal.reason); };
      signal?.addEventListener('abort', cancel, { once: true });
      this.queue.push(entry);
    });
  }
  release() {
    const next = this.queue.shift();
    if (next) next.resolve(); // Transfer the occupied slot; no oversubscription window.
    else this.active--;
  }
  async call(messages, { signal, onPhase, onResult, apiKey, maxTokens = this.maxTokens } = {}) {
    const callKey = this.provider === 'siliconflow' ? apiKey : this.key;
    if (!callKey) throw new Error('请填写硅基流动 API Key。');
    const bytes = Buffer.byteLength(JSON.stringify(messages));
    if (bytes > 64000) throw new Error('本轮上下文超过限制，请缩短指令。');
    const deadline = Date.now() + this.timeoutMs;
    const deadlineSignal = AbortSignal.timeout(this.timeoutMs);
    const callSignal = signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal;
    for (let attempt = 0; ; attempt++) {
      try { await this.acquire(callSignal, onPhase); }
      catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (deadlineSignal.aborted) throw new Error('模型服务响应超时，请稍后重试。');
        throw error;
      }
      let retry = false;
      try {
        signal?.throwIfAborted();
        if (this.callLimit > 0 && this.used >= this.callLimit) throw new Error('模型调用额度已用完。');
        const reserve = ((bytes + 256) * this.inputRate + maxTokens * this.outputRate) / 1e6;
        if (this.budget.limit !== null && this.budget.spent + reserve > this.budget.limit) throw new Error('本次测试的模型预算已用完。');
        this.used++; this.budget.spent += reserve;
        // Durable before dispatch: restarting cannot erase in-flight spending.
        await this.onChange();
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('模型服务响应超时，请稍后重试。');
        // Most Qwen turns finish quickly. If the first request stalls, use the
        // remaining budget for one fresh request instead of ending the match.
        const attemptLimit = attempt === 0 && this.retries > 0
          ? Math.min(remaining, Math.floor(this.timeoutMs * .6)) : remaining;
        const timeout = AbortSignal.timeout(attemptLimit);
        const combined = AbortSignal.any([callSignal, timeout]);
        onPhase?.('request');
        let settled = false;
        try {
          const response = await fetch(this.url, { method: 'POST', signal: combined,
            headers: { authorization: `Bearer ${callKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model: this.model, messages,
              ...(this.provider === 'aliyun' || this.provider === 'siliconflow' ? { enable_thinking: false } : { thinking: { type: 'disabled' } }),
              temperature: 0, max_tokens: maxTokens }) });
          if (!response.ok) {
            retry = response.status === 429 || response.status >= 500;
            await response.body?.cancel();
            if (this.provider === 'siliconflow' && [401, 403].includes(response.status))
              throw new Error('API Key 无效，或当前账号无权使用指定模型。');
            if (this.provider === 'siliconflow' && response.status === 402)
              throw new Error('硅基流动拒绝调用：账号余额不足（402）。请核对免费型号与账号可用状态；本次不产生有效初筛结果。');
            if (this.provider === 'siliconflow' && response.status === 429 && attempt >= this.retries)
              throw new Error('模型免费档限速，请稍后重试。');
            throw new Error(`模型接口暂不可用（${response.status}）。`);
          }
          const value = await response.json();
          const usage = value.usage;
          if (Number.isFinite(usage?.prompt_tokens) && usage.prompt_tokens >= 0 &&
              Number.isFinite(usage?.completion_tokens) && usage.completion_tokens >= 0) {
            const cost = (usage.prompt_tokens * this.inputRate + usage.completion_tokens * this.outputRate) / 1e6;
            this.budget.spent += cost - reserve;
            this.budget.inputTokens += usage.prompt_tokens; this.budget.outputTokens += usage.completion_tokens;
            settled = true;
          }
          const message = value.choices?.[0]?.message;
          if (message?.reasoning_content) throw new Error('模型返回了思考内容，已停止本局。');
          if (typeof message?.content !== 'string' || !message.content.trim()) throw new Error('模型返回空回复，本轮未计数。');
          // Metadata only: never log prompts, replies, keys or credentials.
          const finish = value.choices?.[0]?.finish_reason;
          onResult?.({ finishReason: ['stop','length','content_filter','tool_calls'].includes(finish) ? finish : 'unknown',
            maxTokens, outputTokens: Number.isFinite(usage?.completion_tokens) ? usage.completion_tokens : null,
            returnedChars: message.content.length, clipped: message.content.length > 4000 });
          return message.content.slice(0, 4000);
        } finally {
          if (!settled) this.budget.uncertain++;
          await this.onChange();
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (deadlineSignal.aborted) throw new Error('模型服务响应超时，请稍后重试。');
        if (error?.message === 'fetch failed') {
          console.error('模型连接失败：', error.cause?.code || 'NETWORK');
          throw new Error('模型服务暂时无法连接，请稍后重试。');
        }
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          if (attempt >= this.retries || deadline - Date.now() <= 700) throw new Error('模型服务响应超时，请稍后重试。');
          retry = true;
        }
        if (!retry || attempt >= this.retries || Date.now() >= deadline) throw error;
      } finally { this.release(); }
      onPhase?.('retrying');
      try { await delay(Math.min(600 * (attempt + 1), Math.max(0, deadline - Date.now() - 1)), undefined, { signal: callSignal }); }
      catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (deadlineSignal.aborted) throw new Error('模型服务响应超时，请稍后重试。');
        throw error;
      }
    }
  }
}
