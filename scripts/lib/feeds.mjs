import Parser from 'rss-parser';

const parser = new Parser({ timeout: 15000 });

export function withinWindow(item, now = new Date(), hours = 24) {
  const t = item.isoDate ? Date.parse(item.isoDate) : NaN;
  if (Number.isNaN(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age <= hours * 3600 * 1000;
}

export function stripHtml(html) {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

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

export function normalizeItem(raw, sourceName) {
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
  return {
    title: (raw.title ?? '').trim(),
    link: raw.link ?? '',
    author: raw.creator || raw.author || sourceName,
    source: sourceName,
    snippet: content.slice(0, 500),
    content,
    isoDate: raw.isoDate ?? null,
  };
}

export async function fetchGroup(feeds, { now = new Date(), hours = 24 } = {}) {
  const items = [];
  const failed = [];
  const results = await Promise.allSettled(
    feeds.map((f) =>
      parser.parseURL(f.url).then((p) => p.items.map((i) => normalizeItem(i, f.name))),
    ),
  );
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      items.push(...r.value.filter((i) => i.title && i.link && withinWindow(i, now, hours)));
    } else {
      failed.push(feeds[idx].name);
    }
  });
  return { items, failed };
}
