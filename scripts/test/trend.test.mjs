import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrend } from '../lib/trend.mjs';

test('buildTrend 汇总条目并返回段落', async () => {
  let prompt = '';
  const chat = async (messages) => {
    prompt = messages[1].content;
    return '今天的主线是 X。多篇文章讨论 Y。';
  };
  const t = await buildTrend(chat, [{ name: 'A', picks: [{ title: 't1', summary: 's1' }] }]);
  assert.ok(t.includes('主线'));
  assert.ok(prompt.includes('[A] t1：s1'), '输入应含栏目名、标题与摘要');
});

test('buildTrend 两次失败返回 null', async () => {
  const chat = async () => {
    throw new Error('boom');
  };
  assert.equal(await buildTrend(chat, [{ name: 'A', picks: [{ title: 't', summary: 's' }] }]), null);
});

test('buildTrend 无条目返回 null', async () => {
  assert.equal(await buildTrend(async () => '', []), null);
});
