# Article Content Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 入选文章的 RSS 正文不足时抓取原文正文，让摘要基于具体内容，并移除无信息的占位式摘要。

**Architecture:** 保持现有「RSS 抓取 → LLM 评分 → LLM 摘要」结构，在 `feeds.mjs` 增加可测试的 HTML 正文提取和按需回填函数，在 `select.mjs` 的入选与摘要之间调用。所有网络依赖通过 `fetchImpl` 注入，测试只使用本地 HTML 假响应。

**Tech Stack:** Node.js 22、ES modules、Node.js test runner、内置 `fetch`、现有 `rss-parser`。

## Global Constraints

- 只对 `section.key !== 'jike'` 且正文少于 300 字的入选条目请求原文。
- 原文请求超时 10 秒，摘要正文最多 6000 字，RSS 正文最多 2500 字，`snippet` 最多 500 字。
- 正文选择顺序为 `<article>`、`<main>`、`<body>`；移除 `script`、`style`、`nav`、`header`、`footer`、`aside`、`noscript`、`svg`、`form`。
- 不新增运行时依赖，不修改 CI/CD，不重新生成历史期刊。
- 单页失败保留 RSS 内容并继续，禁止发布「未提供具体内容」「建议查阅原文」「值得关注后续」等占位摘要。
- 每个生产行为先运行对应失败测试，再写最小实现。

---

### Task 1: RSS 多字段归一化

**Files:**
- Modify: `scripts/test/feeds.test.mjs`
- Modify: `scripts/lib/feeds.mjs`

**Interfaces:**
- Consumes: `stripHtml(html: unknown): string`
- Produces: `normalizeItem(raw: object, sourceName: string)`，其 `content` 和 `snippet` 来自 `content:encoded`、`content`、`summary`、`description`、`contentSnippet` 中清洗后的最长文本。

- [ ] **Step 1: 写入失败测试**

在 `scripts/test/feeds.test.mjs` 添加：

```js
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
```

该测试防止归一化逻辑继续忽略 `summary`／`description`，或按字段优先级选到更短内容。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test scripts/test/feeds.test.mjs`

Expected: 新测试 FAIL，实际 `content` 为 `短内容`。

- [ ] **Step 3: 写入最小实现**

把 `normalizeItem()` 开头改为：

```js
const candidates = [
  raw['content:encoded'],
  raw.content,
  raw.summary,
  raw.description,
  raw.contentSnippet,
]
  .map((value) => stripHtml(value ?? ''))
  .filter(Boolean)
  .sort((a, b) => b.length - a.length);
const content = (candidates[0] ?? '').slice(0, 2500);
```

返回对象中的两个字段改为：

```js
snippet: content.slice(0, 500),
content,
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test scripts/test/feeds.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/feeds.mjs scripts/test/feeds.test.mjs
git commit -m "fix: RSS 归一化选择信息最完整的内容字段"
```

### Task 2: HTML 主要正文提取

**Files:**
- Modify: `scripts/test/feeds.test.mjs`
- Modify: `scripts/lib/feeds.mjs`

**Interfaces:**
- Consumes: `stripHtml(html: unknown): string`
- Produces: `extractArticleText(html: unknown, maxContentLength?: number): string`

- [ ] **Step 1: 写入失败测试**

将 `feeds.mjs` 改为命名空间导入，以便缺少新导出时得到行为失败而不是模块加载错误：

```js
import * as feeds from '../lib/feeds.mjs';
const { withinWindow, normalizeItem, stripHtml } = feeds;
```

添加 Simon Willison 风格 HTML 测试：

```js
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
```

这两项测试分别防止噪声进入正文，以及缺少 `<article>` 时错误返回空文本。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test scripts/test/feeds.test.mjs`

Expected: 新测试 FAIL，提示 `feeds.extractArticleText is not a function`。

- [ ] **Step 3: 写入最小实现**

在 `feeds.mjs` 增加：

```js
const NOISE_TAGS = 'script|style|nav|header|footer|aside|noscript|svg|form';

function elementContents(html, tag) {
  return String(html).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] ?? '';
}

export function extractArticleText(html, maxContentLength = 6000) {
  const source = String(html ?? '');
  const region = ['article', 'main', 'body']
    .map((tag) => elementContents(source, tag))
    .find(Boolean) ?? '';
  const withoutNoise = region.replace(
    new RegExp(`<(${NOISE_TAGS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'),
    ' ',
  );
  return stripHtml(withoutNoise).slice(0, maxContentLength);
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test scripts/test/feeds.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/feeds.mjs scripts/test/feeds.test.mjs
git commit -m "feat: 从文章语义区域提取可摘要正文"
```

### Task 3: 入选文章按需回填

**Files:**
- Modify: `scripts/test/feeds.test.mjs`
- Modify: `scripts/lib/feeds.mjs`

**Interfaces:**
- Consumes: `extractArticleText(html, maxContentLength)`、条目对象 `{ link, source, content, snippet }`
- Produces: `enrichSelectedContent(items, options): Promise<object[]>`
- `options.fetchImpl` 与标准 `fetch(url, init)` 兼容；`options.minContentLength` 默认 300；`options.maxContentLength` 默认 6000；`options.timeoutMs` 默认 10000。

- [ ] **Step 1: 写入所有回填行为的失败测试**

```js
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

test('enrichSelectedContent 单页失败时保留该项并继续其他条目', async () => {
  const failed = { link: 'https://example.com/fail', source: 'S', content: '原 RSS' };
  const valid = { link: 'https://example.com/ok', source: 'S', content: '短 RSS' };
  const fetchImpl = async (url) => url.endsWith('/fail')
    ? { ok: false, status: 503, headers: { get: () => 'text/html' }, text: async () => '' }
    : { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => `<article>${'正文'.repeat(4000)}</article>` };

  const results = await feeds.enrichSelectedContent([failed, valid], { fetchImpl });

  assert.equal(results[0], failed);
  assert.equal(results[1].content.length, 6000);
});

test('enrichSelectedContent 非 HTML 响应保留 RSS 内容', async () => {
  const original = { link: 'https://example.com/file.pdf', source: 'S', content: '原 RSS' };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/pdf' },
    text: async () => 'PDF bytes',
  });

  assert.equal((await feeds.enrichSelectedContent([original], { fetchImpl }))[0], original);
});

test('enrichSelectedContent 超时拒绝时保留 RSS 内容', async () => {
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
```

这些测试分别防止短 RSS 原样进入摘要、正文足够时无谓抓取、单页失败拖垮批次、超长正文绕过上限、非 HTML 被错误摘要、超时中断批次，以及空页面覆盖已有内容。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test scripts/test/feeds.test.mjs`

Expected: 六项新测试 FAIL，首要失败原因是 `feeds.enrichSelectedContent is not a function`。

- [ ] **Step 3: 写入覆盖上述行为的最小实现**

在 `feeds.mjs` 增加：

```js
function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export async function enrichSelectedContent(items, {
  fetchImpl = globalThis.fetch,
  minContentLength = 300,
  maxContentLength = 6000,
  timeoutMs = 10000,
} = {}) {
  return Promise.all(items.map(async (item) => {
    const current = String(item.content ?? item.snippet ?? '').trim();
    if (current.length >= minContentLength || !isHttpUrl(item.link)) return item;

    try {
      const response = await fetchImpl(item.link, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'KzyoDigest/1.0 (+https://alainouyang.github.io/digest/)',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error(`非 HTML 响应：${contentType}`);
      }
      const extracted = extractArticleText(await response.text(), maxContentLength);
      return extracted.length > current.length ? { ...item, content: extracted } : item;
    } catch (error) {
      console.error(`[${item.source}] 原文回填失败 ${item.link}：${error.message}`);
      return item;
    }
  }));
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test scripts/test/feeds.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/feeds.mjs scripts/test/feeds.test.mjs
git commit -m "feat: 为短 RSS 入选文章按需回填原文"
```

### Task 4: 在摘要阶段接入回填并屏蔽占位话术

**Files:**
- Modify: `scripts/test/select.test.mjs`
- Modify: `scripts/lib/select.mjs`

**Interfaces:**
- Consumes: `enrichSelectedContent(items): Promise<object[]>`
- Produces: `selectAndSummarize(chat, section, items, { enrich? }): Promise<{ picks, degraded }>`
- `enrich` 默认指向 `enrichSelectedContent`，测试可注入本地实现；即刻栏目不调用 `enrich`。

- [ ] **Step 1: 写入原文进入模型的失败测试**

```js
test('selectAndSummarize 在评分后将回填正文交给摘要模型', async () => {
  let call = 0;
  let summaryPrompt = '';
  const fakeChat = async (messages) => {
    call += 1;
    if (call === 1) return '[{"i":0,"score":10},{"i":1,"score":1},{"i":2,"score":1}]';
    summaryPrompt = messages[1].content;
    return '[{"i":0,"summary":"基于原文的摘要"}]';
  };
  const enrich = async (chosen) => chosen.map((item) => ({
    ...item,
    content: 'Greg Brockman 描述 ChatGPT 主动联系同事并协调工作安排。',
  }));

  await selectAndSummarize(fakeChat, { ...section, topN: 1 }, items, { enrich });

  assert.ok(summaryPrompt.includes('ChatGPT 主动联系同事并协调工作安排'));
});
```

该测试防止回填函数存在但没有接入摘要数据流。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test scripts/test/select.test.mjs`

Expected: 新测试 FAIL，因为第四个参数被忽略，摘要提示仍包含 `full-a`。

- [ ] **Step 3: 接入回填依赖**

在 `select.mjs` 导入并接入：

```js
import { enrichSelectedContent } from './feeds.mjs';

async function attempt(chat, section, items, enrich) {
  const list = items.map((it, i) => ({ i, title: it.title, snippet: it.snippet.slice(0, 200) }));
  const scored = extractJson(
    await chat([
      { role: 'system', content: '你是内容编辑，只输出 JSON，不输出其他文字。' },
      {
        role: 'user',
        content: `按与「${section.focus}」的相关性与内容质量给每条打 1-10 分，输出 [{"i":序号,"score":分数}]：\n${JSON.stringify(list)}`,
      },
    ]),
  );
  const selected = scored
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, section.topN)
    .map((s) => items[s.i])
    .filter(Boolean);
  if (selected.length === 0) return [];
  const chosen = section.key === 'jike' ? selected : await enrich(selected);
  const summaries = extractJson(
    await chat([
      { role: 'system', content: '你是中文技术编辑，只输出 JSON，不输出其他文字。' },
      {
        role: 'user',
        content: `为每条写 3-4 句中文摘要（120-180 字）：先说讲了什么，再给关键结论或数据，最后一句说为什么值得读。原文很短的条目（如社交动态）提炼核心观点即可，不要硬凑字数。只输出 JSON [{"i":序号,"summary":"..."}]：\n${JSON.stringify(chosen.map((c, i) => ({ i, title: c.title, text: (c.content ?? c.snippet).slice(0, 6000) })))}`,
      },
    ]),
  );
  return chosen.map((c, i) => ({
    ...c,
    summary: summaries.find((s) => s.i === i)?.summary ?? '',
  }));
}

export async function selectAndSummarize(
  chat,
  section,
  items,
  { enrich = enrichSelectedContent } = {},
) {
  if (items.length === 0) return { picks: [], degraded: false };
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      return { picks: await attempt(chat, section, items, enrich), degraded: false };
    } catch (e) {
      console.error(`[${section.name}] 第 ${tries + 1} 次尝试失败：${e.message}`);
    }
  }
  const picks = [...items]
    .sort((a, b) => Date.parse(b.isoDate ?? 0) - Date.parse(a.isoDate ?? 0))
    .slice(0, section.topN)
    .map((it) => ({ ...it, summary: '' }));
  return { picks, degraded: true };
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test scripts/test/select.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 5: 写入即刻回归测试和占位摘要失败测试**

```js
test('selectAndSummarize 即刻栏目跳过原文回填', async () => {
  let call = 0;
  const fakeChat = async () => {
    call += 1;
    return call === 1
      ? '[{"i":0,"score":10}]'
      : '[{"i":0,"summary":"短动态核心观点"}]';
  };
  const enrich = async () => { throw new Error('即刻条目不应请求原文'); };

  const result = await selectAndSummarize(
    fakeChat,
    { key: 'jike', name: '即刻简报', focus: 'AI', topN: 1 },
    [items[0]],
    { enrich },
  );

  assert.equal(result.degraded, false);
  assert.equal(result.picks[0].summary, '短动态核心观点');
});

test('selectAndSummarize 丢弃占位式摘要', async () => {
  let call = 0;
  const fakeChat = async () => {
    call += 1;
    return call === 1
      ? '[{"i":0,"score":10}]'
      : '[{"i":0,"summary":"本条目未提供具体内容，建议读者查阅原文。"}]';
  };

  const result = await selectAndSummarize(
    fakeChat,
    { ...section, topN: 1 },
    [items[0]],
    { enrich: async (chosen) => chosen },
  );

  assert.equal(result.picks[0].summary, '');
});
```

即刻测试确认接入回填后仍保留短动态行为；占位摘要测试复现截图中的错误话术。

- [ ] **Step 6: 运行测试并确认按预期失败**

Run: `node --test scripts/test/select.test.mjs`

Expected: 即刻测试在 Step 3 后 PASS；占位摘要测试 FAIL，实际值仍为模型原话。

- [ ] **Step 7: 写入摘要防护最小实现**

在 `select.mjs` 增加：

```js
const PLACEHOLDER_SUMMARY = /未提供具体|没有提供具体|具体(?:内容|信息|更新)?未详述|未列举|建议.{0,8}(?:查阅|阅读|查看).{0,8}(?:原文|链接)|值得关注.{0,8}(?:后续|进展)/;

function sanitizeSummary(value) {
  const summary = String(value ?? '').trim();
  return PLACEHOLDER_SUMMARY.test(summary) ? '' : summary;
}
```

把摘要提示补充为：

```text
只能总结输入文本明确提供的信息，不得根据标题、作者身份或常识补写事实。证据不足时 summary 返回空字符串，不得写「未提供具体内容」「建议查阅原文」「值得关注后续」等占位话术。
```

并将返回映射改为：

```js
return chosen.map((item, i) => ({
  ...item,
  summary: sanitizeSummary(summaries.find((summary) => summary.i === i)?.summary),
}));
```

- [ ] **Step 8: 运行栏目测试和全量测试**

Run: `node --test scripts/test/select.test.mjs`

Expected: 全部 PASS。

Run: `npm test`

Expected: 全部 PASS，0 项失败。

- [ ] **Step 9: 提交**

```bash
git add scripts/lib/select.mjs scripts/test/select.test.mjs
git commit -m "fix: 摘要前回填原文并过滤无信息占位话术"
```

### Task 5: 完整验证和进度收口

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: 前四项任务的全部实现和测试。
- Produces: 可审计的完成状态和本地提交历史。

- [ ] **Step 1: 运行完整测试**

Run: `npm test`

Expected: 所有旧测试和新增测试 PASS，0 项失败。

- [ ] **Step 2: 验证期刊内容契约**

Run: `npm run verify`

Expected: 输出 `issue contract: PASS`。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: Astro 构建成功，21 个现有页面全部生成。

- [ ] **Step 4: 检查改动范围**

Run: `git diff origin/master...HEAD --stat`

Expected: 只包含 `CLAUDE.md`、`ROADMAP.md`、设计／计划文档、`feeds.mjs`、`select.mjs` 及其测试；不包含 `.github/workflows/`、Secrets 或历史期刊改写。

- [ ] **Step 5: 更新 Roadmap**

在 `ROADMAP.md`：

- 将原文回填修复移动到“已完成”，写明最终测试数量。
- 清空“进行中”。
- 在“最近验证”记录 `npm test`、`npm run verify`、`npm run build` 的实际结果。
- 保留“未经主人授权不得 push／发布”。

- [ ] **Step 6: 提交收口文档**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-08-03-article-content-fallback.md
git commit -m "docs: 记录原文回填实施计划与验证结果"
```

- [ ] **Step 7: 核对提交和工作区**

Run: `git status --short --branch`

Expected: 工作区干净，分支为 `codex/article-content-fallback`，领先 `origin/master`；不执行 push。
