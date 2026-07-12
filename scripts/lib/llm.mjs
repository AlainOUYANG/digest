export function createClient(env = process.env) {
  const baseUrl = env.ARK_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3';
  const apiKey = env.ARK_API_KEY;
  const model = env.ARK_MODEL;
  if (!apiKey || !model) throw new Error('需要 ARK_API_KEY 与 ARK_MODEL 环境变量');
  return async function chat(messages) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.3 }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()).choices[0].message.content;
  };
}
