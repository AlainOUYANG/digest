import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, selectAndSummarize } from '../lib/select.mjs';

const section = { key: 'ai', name: 'AI 技术博客', focus: 'AI 应用', topN: 2 };
const items = [
  { title: 'A', link: 'https://x/a', author: 'a', source: 's', snippet: 'sa', content: 'full-a', isoDate: '2026-07-12T10:00:00Z' },
  { title: 'B', link: 'https://x/b', author: 'b', source: 's', snippet: 'sb', content: 'full-b', isoDate: '2026-07-12T09:00:00Z' },
  { title: 'C', link: 'https://x/c', author: 'c', source: 's', snippet: 'sc', content: 'full-c', isoDate: '2026-07-12T11:00:00Z' },
];

test('extractJson 解析裸 JSON 数组', () => {
  assert.deepEqual(extractJson('[{"i":0,"score":5}]'), [{ i: 0, score: 5 }]);
});

test('extractJson 解析 json 围栏', () => {
  assert.deepEqual(extractJson('```json\n[{"i":1}]\n```'), [{ i: 1 }]);
});

test('extractJson 解析混杂文字的回复', () => {
  assert.deepEqual(extractJson('结果如下：[{"i":2}] 希望有帮助'), [{ i: 2 }]);
});

test('extractJson 无数组时抛错', () => {
  assert.throws(() => extractJson('抱歉我做不到'));
});

test('selectAndSummarize 按分取 topN 并拼接摘要', async () => {
  let call = 0;
  let summaryPrompt = '';
  const fakeChat = async (messages) => {
    call += 1;
    if (call === 1) return '[{"i":0,"score":3},{"i":1,"score":9},{"i":2,"score":7}]';
    summaryPrompt = messages[1].content;
    return '[{"i":0,"summary":"摘要B"},{"i":1,"summary":"摘要C"}]';
  };
  const { picks, degraded } = await selectAndSummarize(fakeChat, section, items);
  assert.equal(degraded, false);
  assert.deepEqual(picks.map((p) => p.title), ['B', 'C']);
  assert.deepEqual(picks.map((p) => p.summary), ['摘要B', '摘要C']);
  assert.ok(summaryPrompt.includes('full-b'), '摘要输入应使用全文 content 而非 snippet');
  assert.ok(summaryPrompt.includes('3-4 句'), '摘要要求应为 3-4 句');
});

test('selectAndSummarize 连续失败时降级为按时间取 topN 且无摘要', async () => {
  const failChat = async () => { throw new Error('boom'); };
  const { picks, degraded } = await selectAndSummarize(failChat, section, items);
  assert.equal(degraded, true);
  assert.deepEqual(picks.map((p) => p.title), ['C', 'A']);
  assert.deepEqual(picks.map((p) => p.summary), ['', '']);
});

test('selectAndSummarize 空输入直接返回空', async () => {
  const { picks, degraded } = await selectAndSummarize(async () => '', section, []);
  assert.deepEqual(picks, []);
  assert.equal(degraded, false);
});
