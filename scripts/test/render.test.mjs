import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIssue, escapeMd } from '../lib/render.mjs';

const baseArgs = {
  number: 3,
  date: '2026-07-12',
  sections: [
    {
      name: 'AI 技术博客',
      degraded: false,
      picks: [
        { title: '标题[一]', link: 'https://x/a', author: '作者A', source: 'S1', summary: '这是摘要。' },
      ],
    },
    { name: '因果推断与营销科学', degraded: true, picks: [{ title: 'B', link: 'https://x/b', author: '', source: 'S2', summary: '' }] },
    { name: '即刻简报', degraded: false, picks: [] },
  ],
  failedSources: ['坏源1', '坏源2'],
};

test('frontmatter 含五个字段', () => {
  const out = renderIssue(baseArgs);
  for (const key of ['title: 第 3 期', 'date: 2026-07-12', 'issue: 3', 'unavailableSources:']) {
    assert.ok(out.includes(key), `缺 ${key}`);
  }
});

test('三栏目标题齐全', () => {
  const out = renderIssue(baseArgs);
  for (const name of ['## AI 技术博客', '## 因果推断与营销科学', '## 即刻简报']) {
    assert.ok(out.includes(name), `缺 ${name}`);
  }
});

test('条目行含链接与署名分隔符，标题方括号被转义', () => {
  const out = renderIssue(baseArgs);
  assert.ok(out.includes('- **[标题\\[一\\]](https://x/a)** — 作者A'));
  assert.ok(out.includes('  这是摘要。'));
});

test('无作者时署名回退到 source', () => {
  const out = renderIssue(baseArgs);
  assert.ok(out.includes('](https://x/b)** — S2'));
});

test('degraded 栏目含降级说明', () => {
  const out = renderIssue(baseArgs);
  assert.ok(out.includes('（本期摘要服务不可用，仅提供标题与链接。）'));
});

test('空栏目输出占位文案', () => {
  const out = renderIssue(baseArgs);
  assert.ok(out.includes('本栏目今日无入选内容。'));
});

test('failedSources 汇总行', () => {
  const out = renderIssue(baseArgs);
  assert.ok(out.includes('> 本期有 2 个源不可用：坏源1、坏源2。'));
});

test('failedSources 为空时无汇总行', () => {
  const out = renderIssue({ ...baseArgs, failedSources: [] });
  assert.ok(!out.includes('个源本期不可用'));
  assert.ok(!out.includes('> 本期有'));
});

test('escapeMd 只转义方括号', () => {
  assert.equal(escapeMd('a[b]c'), 'a\\[b\\]c');
});

test('有 trend 时在首个栏目前渲染今日趋势段', () => {
  const out = renderIssue({ ...baseArgs, trend: '今天主线是 X。' });
  const trendPos = out.indexOf('## 今日趋势');
  assert.ok(trendPos > -1);
  assert.ok(out.includes('今天主线是 X。'));
  assert.ok(trendPos < out.indexOf('## AI 技术博客'));
});

test('trend 为 null 或缺省时不渲染趋势段', () => {
  assert.ok(!renderIssue({ ...baseArgs, trend: null }).includes('今日趋势'));
  assert.ok(!renderIssue(baseArgs).includes('今日趋势'));
});
