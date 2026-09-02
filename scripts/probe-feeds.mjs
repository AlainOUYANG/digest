// 诊断指定 feed 的直连与各代理通路，输出 HTTP 状态与响应特征，用于定位源失效原因。
// 用法：node scripts/probe-feeds.mjs [url...]（省略则使用默认待查清单）
import { feedProxies } from './lib/feeds.mjs';

const DEFAULT_TARGETS = [
  'https://gwern.net/index.xml',
  'https://blog.langchain.dev/rss/',
  'https://every.to/api/feed.xml',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function probe(label, url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    const head = body.slice(0, 160).replace(/\s+/g, ' ').trim();
    console.log(
      `  ${label}: HTTP ${res.status} ${res.headers.get('content-type') ?? '-'} ` +
        `${body.length}B ${Date.now() - started}ms\n    ${head}`,
    );
  } catch (error) {
    console.log(`  ${label}: 失败 ${error.name} ${error.message} ${Date.now() - started}ms`);
  }
}

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_TARGETS;
const proxies = feedProxies();

for (const target of targets) {
  console.log(`\n### ${target}`);
  await probe('直连', target);
  for (const template of proxies) {
    const proxied = template.replace('{url}', encodeURIComponent(target)).replace('{raw}', target);
    await probe(`代理 ${new URL(proxied).host}`, proxied);
  }
}
process.exit(0);
