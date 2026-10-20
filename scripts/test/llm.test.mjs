import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../lib/llm.mjs';

const env = { ARK_API_KEY: 'unit-test-secret', ARK_MODEL: 'unit-test-model' };
const messages = [{ role: 'user', content: 'unit test' }];
const ok = (text = '测试摘要') => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
const quiet = { warn() {} };

test('client requires credentials and model', () => {
  assert.throws(() => createClient({}), /ARK_API_KEY/);
  assert.throws(() => createClient({ ARK_API_KEY: 'test' }), /ARK_MODEL/);
});

test('client sends expected request and normalizes base URL', async () => {
  const chat = createClient({ ...env, ARK_BASE_URL: 'https://example.test/api/v3/' }, {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://example.test/api/v3/chat/completions');
      assert.equal(options.headers.authorization, `Bearer ${env.ARK_API_KEY}`);
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { model: env.ARK_MODEL, messages, temperature: 0.3 });
      return ok();
    },
  });
  assert.equal(await chat(messages), '测试摘要');
});

test('default endpoint stays on Ark Beijing', async () => {
  const chat = createClient(env, { fetchImpl: async (url) => {
    assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    return ok();
  } });
  await chat(messages);
});

test('transient connection error is retried once with backoff and cause codes', async () => {
  let calls = 0;
  const waits = [], logs = [];
  const cause = new AggregateError([
    Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:443'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('connect ENETUNREACH ::1'), { code: 'ENETUNREACH' }),
  ]);
  const chat = createClient(env, {
    fetchImpl: async () => { calls++; if (calls === 1) throw new TypeError('fetch failed', { cause }); return ok(); },
    wait: async (ms) => waits.push(ms), logger: { warn: (text) => logs.push(text) },
  });
  assert.equal(await chat(messages), '测试摘要');
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1000]);
  assert.match(logs[0], /ETIMEDOUT/);
  assert.match(logs[0], /ENETUNREACH/);
});

test('persistent network failures remain bounded and redact secrets from cause chain', async () => {
  let calls = 0;
  const logs = [];
  const chat = createClient(env, {
    fetchImpl: async () => { calls++; throw new TypeError(`failed ${env.ARK_API_KEY}`, { cause: Object.assign(new Error('Bearer sensitive-token'), { code: 'ECONNRESET' }) }); },
    wait: async () => {}, logger: { warn: (text) => logs.push(text) },
  });
  await assert.rejects(chat(messages), (error) => {
    assert.match(error.message, /ECONNRESET/);
    assert.match(error.message, /2\/2/);
    assert.ok(!error.message.includes(env.ARK_API_KEY));
    assert.ok(!error.message.includes('sensitive-token'));
    return true;
  });
  assert.equal(calls, 2);
  assert.ok(!logs.join().includes(env.ARK_API_KEY));
});

for (const status of [429, 500, 502, 503, 504]) {
  test(`HTTP ${status} retries once without logging response body`, async () => {
    let calls = 0;
    const chat = createClient(env, {
      fetchImpl: async () => { calls++; return calls === 1 ? new Response('private response', { status }) : ok(); },
      wait: async () => {}, logger: quiet,
    });
    assert.equal(await chat(messages), '测试摘要');
    assert.equal(calls, 2);
  });
}

for (const status of [400, 401, 403, 404]) {
  test(`HTTP ${status} is not retried at client level`, async () => {
    let calls = 0;
    const chat = createClient(env, {
      fetchImpl: async () => { calls++; return new Response('private response', { status }); },
      wait: async () => { assert.fail('unexpected retry'); }, logger: quiet,
    });
    await assert.rejects(chat(messages), (error) => {
      assert.equal(error.status, status);
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.ok(!error.message.includes('private response'));
      return true;
    });
    assert.equal(calls, 1);
  });
}

for (const name of ['TimeoutError', 'AbortError']) {
  test(`${name} is not replayed at client level`, async () => {
    let calls = 0;
    const chat = createClient(env, {
      fetchImpl: async () => { calls++; throw Object.assign(new Error('timed out'), { name }); },
      wait: async () => assert.fail('unexpected retry'), logger: quiet,
    });
    await assert.rejects(chat(messages), /timed out/);
    assert.equal(calls, 1);
  });
}

for (const data of [{}, { choices: [] }, { choices: [{ message: { content: null } }] }, { choices: [{ message: { content: ' ' } }] }]) {
  test(`invalid content is rejected without retry: ${JSON.stringify(data)}`, async () => {
    let calls = 0;
    const chat = createClient(env, {
      fetchImpl: async () => { calls++; return new Response(JSON.stringify(data)); }, logger: quiet,
    });
    await assert.rejects(chat(messages), /missing non-empty message.content/);
    assert.equal(calls, 1);
  });
}

test('truncated model response fails explicitly', async () => {
  const chat = createClient(env, { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '[incomplete' }, finish_reason: 'length' }] })) });
  await assert.rejects(chat(messages), /truncated/);
});
