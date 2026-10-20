import { setTimeout as delay } from 'node:timers/promises';

function describeError(error, depth = 0) {
  if (depth > 3 || !error) return '';
  const parts = [error.name, error.code, error.message].filter(Boolean);
  if (error.cause) parts.push(`cause: ${describeError(error.cause, depth + 1)}`);
  if (error.errors) parts.push(...error.errors.slice(0, 4).map((e) => describeError(e, depth + 1)));
  return parts.join(' | ');
}

function redact(text, secret) {
  return String(text).replaceAll(secret, '[REDACTED]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').slice(0, 1800);
}

export function createClient(env = process.env, {
  fetchImpl = globalThis.fetch,
  wait = delay,
  logger = console,
  timeoutMs = 120000,
} = {}) {
  const baseUrl = (env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  const apiKey = env.ARK_API_KEY;
  const model = env.ARK_MODEL;
  if (!apiKey || !model) throw new Error('需要 ARK_API_KEY 与 ARK_MODEL 环境变量');
  return async function chat(messages) {
    // A bounded retry for transient connection/HTTP errors; do not replay timeouts
    // or invalid model output, since the provider may already have processed them.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let retryable = false;
      try {
        let res;
        try {
          res = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages, temperature: 0.3 }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          retryable = error.name !== 'AbortError' && error.name !== 'TimeoutError';
          throw error;
        }
        if (!res.ok) {
          retryable = [429, 500, 502, 503, 504].includes(res.status);
          // Do not print server response bodies, prompts, credentials, or model IDs.
          await res.body?.cancel();
          const error = new Error(`LLM HTTP ${res.status}`);
          error.status = res.status;
          throw error;
        }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          throw new Error('LLM response missing non-empty message.content');
        }
        if (data.choices[0].finish_reason === 'length') {
          throw new Error('LLM response truncated (finish_reason=length)');
        }
        return content;
      } catch (error) {
        const detail = redact(describeError(error), apiKey);
        if (retryable && attempt < 2) {
          logger.warn(`[LLM] 请求失败，1 秒后重试（${attempt}/2）：${detail}`);
          await wait(1000);
          continue;
        }
        // Existing section/trend handlers only print .message, so include the
        // sanitized cause chain here rather than losing ETIMEDOUT/ENETUNREACH.
        const failure = new Error(`LLM request failed (${attempt}/2): ${detail}`);
        failure.status = error.status;
        throw failure;
      }
    }
  };
}
