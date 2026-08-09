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
