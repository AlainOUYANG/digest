import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const issues = (await getCollection('issues')).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );
  return rss({
    title: 'Kzyo 每日简报',
    description: '每天聚合 AI 技术博客、因果推断与营销科学、即刻动态的中文简报。',
    site: new URL(import.meta.env.BASE_URL, context.site),
    items: issues.map((entry) => ({
      title: entry.data.title,
      pubDate: entry.data.date,
      link: `${import.meta.env.BASE_URL}issues/${entry.id}/`,
    })),
  });
}
