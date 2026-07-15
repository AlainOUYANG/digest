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

export function normalizeItem(raw, sourceName) {
  const fullText = raw['content:encoded'] || raw.content || '';
  const snippet = (raw.contentSnippet ?? '').slice(0, 500);
  return {
    title: (raw.title ?? '').trim(),
    link: raw.link ?? '',
    author: raw.creator || raw.author || sourceName,
    source: sourceName,
    snippet,
    content: (fullText ? stripHtml(fullText) : snippet).slice(0, 2500),
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
