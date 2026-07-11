import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withinWindow, normalizeItem } from '../lib/feeds.mjs';

const now = new Date('2026-07-12T12:00:00Z');

test('withinWindow 接受 1 小时前的条目', () => {
  assert.equal(withinWindow({ isoDate: '2026-07-12T11:00:00Z' }, now, 24), true);
});

test('withinWindow 拒绝 25 小时前的条目', () => {
  assert.equal(withinWindow({ isoDate: '2026-07-11T11:00:00Z' }, now, 24), false);
});

test('withinWindow 拒绝未来时间的条目', () => {
  assert.equal(withinWindow({ isoDate: '2026-07-12T13:00:00Z' }, now, 24), false);
});

test('withinWindow 拒绝无日期的条目', () => {
  assert.equal(withinWindow({ isoDate: null }, now, 24), false);
  assert.equal(withinWindow({}, now, 24), false);
});

test('normalizeItem 无作者时回退到源名', () => {
  const item = normalizeItem({ title: ' T ', link: 'https://a.b/c' }, 'MySource');
  assert.equal(item.author, 'MySource');
  assert.equal(item.title, 'T');
  assert.equal(item.source, 'MySource');
});

test('normalizeItem 截断 snippet 到 500 字', () => {
  const item = normalizeItem({ title: 'T', link: 'x', contentSnippet: 'a'.repeat(600) }, 'S');
  assert.equal(item.snippet.length, 500);
});
