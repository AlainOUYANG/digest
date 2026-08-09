import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as feeds from '../lib/feeds.mjs';

const { withinWindow, normalizeItem, stripHtml } = feeds;

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

test('stripHtml 剥标签并解码常见实体', () => {
  assert.equal(stripHtml('<p>a &amp; b&nbsp;<b>c</b></p>'), 'a & b c');
});

test('normalizeItem 优先 content:encoded 并截断 2500 字', () => {
  const raw = { title: 'T', link: 'x', contentSnippet: 'short', 'content:encoded': `<p>${'长'.repeat(3000)}</p>` };
  const item = normalizeItem(raw, 'S');
  assert.equal(item.content.length, 2500);
  assert.ok(!item.content.includes('<p>'));
});

test('normalizeItem 无全文时 content 回退 snippet', () => {
  const item = normalizeItem({ title: 'T', link: 'x', contentSnippet: 'only snippet' }, 'S');
  assert.equal(item.content, 'only snippet');
});

test('normalizeItem 从 RSS 多字段选择清洗后最长文本', () => {
  const item = normalizeItem({
    title: 'T',
    link: 'https://example.com/t',
    content: '<p>短内容</p>',
    summary: '<p>summary 中等长度</p>',
    description: '<p>description 提供了更完整的正文事实</p>',
    contentSnippet: '一句简介',
  }, 'S');

  assert.equal(item.content, 'description 提供了更完整的正文事实');
  assert.equal(item.snippet, 'description 提供了更完整的正文事实');
});

test('extractArticleText 优先提取 article 并移除页面噪声', () => {
  const html = `
    <body>
      <nav>站点导航</nav>
      <article>
        <header>文章头部</header>
        <p>Greg Brockman 说 ChatGPT 会主动联系同事并协调工作。</p>
        <script>window.secret = '不要进入正文';</script>
        <p>这展示了智能体对人际协作关系的影响。</p>
      </article>
      <footer>版权信息</footer>
    </body>`;

  assert.equal(
    feeds.extractArticleText(html),
    'Greg Brockman 说 ChatGPT 会主动联系同事并协调工作。 这展示了智能体对人际协作关系的影响。',
  );
});

test('extractArticleText 没有 article 时依次回退 main 和 body', () => {
  assert.equal(feeds.extractArticleText('<main><p>主区域事实</p></main>'), '主区域事实');
  assert.equal(feeds.extractArticleText('<body><p>页面事实</p></body>'), '页面事实');
});

test('enrichSelectedContent 用原文正文替换过短 RSS 内容', async () => {
  const original = {
    title: 'Quoting Greg Brockman',
    link: 'https://example.com/post',
    source: 'Simon Willison',
    content: 'RSS 只有一句简介',
    snippet: 'RSS 只有一句简介',
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => '<article><p>Greg Brockman 描述 ChatGPT 主动联系同事并协调工作安排。</p></article>',
  });

  const [result] = await feeds.enrichSelectedContent([original], { fetchImpl });

  assert.equal(result.content, 'Greg Brockman 描述 ChatGPT 主动联系同事并协调工作安排。');
});

test('enrichSelectedContent 正文达到门槛时保留原对象', async () => {
  const original = { link: 'https://example.com/full', source: 'S', content: '足'.repeat(300) };
  const fetchImpl = async () => { throw new Error('达到门槛后不应访问网络'); };

  assert.equal((await feeds.enrichSelectedContent([original], { fetchImpl }))[0], original);
});

test('enrichSelectedContent 单页失败时保留该项并继续其他条目', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failed = { link: 'https://example.com/fail', source: 'S', content: '原 RSS' };
  const valid = { link: 'https://example.com/ok', source: 'S', content: '短 RSS' };
  const fetchImpl = async (url) => url.endsWith('/fail')
    ? { ok: false, status: 503, headers: { get: () => 'text/html' }, text: async () => '' }
    : {
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        text: async () => `<article>${'正文'.repeat(4000)}</article>`,
      };

  const results = await feeds.enrichSelectedContent([failed, valid], { fetchImpl });

  assert.equal(results[0], failed);
  assert.equal(results[1].content.length, 6000);
});

test('enrichSelectedContent 非 HTML 响应保留 RSS 内容', async (t) => {
  t.mock.method(console, 'error', () => {});
  const original = { link: 'https://example.com/file.pdf', source: 'S', content: '原 RSS' };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/pdf' },
    text: async () => 'PDF bytes',
  });

  assert.equal((await feeds.enrichSelectedContent([original], { fetchImpl }))[0], original);
});

test('enrichSelectedContent 超时拒绝时保留 RSS 内容', async (t) => {
  t.mock.method(console, 'error', () => {});
  const original = { link: 'https://example.com/slow', source: 'S', content: '原 RSS' };
  const fetchImpl = async () => { throw new DOMException('请求超时', 'TimeoutError'); };

  assert.equal((await feeds.enrichSelectedContent([original], { fetchImpl }))[0], original);
});

test('enrichSelectedContent 无有效正文时保留 RSS 内容', async () => {
  const original = { link: 'https://example.com/empty', source: 'S', content: '原 RSS' };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/html' },
    text: async () => '<body><nav>只有导航</nav></body>',
  });

  assert.equal((await feeds.enrichSelectedContent([original], { fetchImpl }))[0], original);
});
