import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fetchGroup } from './lib/feeds.mjs';
import { createClient } from './lib/llm.mjs';
import { selectAndSummarize } from './lib/select.mjs';
import { renderIssue } from './lib/render.mjs';

const CONTENT_DIR = new URL('../src/content/issues/', import.meta.url);
const loadJson = (p) => JSON.parse(readFileSync(new URL(`../config/${p}`, import.meta.url), 'utf8'));

const sectionsCfg = loadJson('sections.json');
const jikeUsers = loadJson('jike-users.json');
const rsshubBases = (process.env.RSSHUB_BASES ?? 'https://rsshub.app').split(',');
const chat = createClient();
const now = new Date();
const today = now.toISOString().slice(0, 10);

const jikeFeeds = (base) =>
  jikeUsers.map((u) => ({ name: `即刻·${u.name}`, url: `${base}/jike/user/${u.id}` }));

const failedSources = [];
const sections = [];
for (const cfg of sectionsCfg) {
  const feeds = cfg.key === 'jike' ? jikeFeeds(rsshubBases[0]) : loadJson(cfg.feeds);
  let { items, failed } = await fetchGroup(feeds, { now });
  if (cfg.key === 'jike' && jikeUsers.length > 0 && items.length === 0 && rsshubBases[1]) {
    ({ items, failed } = await fetchGroup(jikeFeeds(rsshubBases[1]), { now }));
  }
  failedSources.push(...failed);
  const { picks, degraded } = await selectAndSummarize(chat, cfg, items);
  sections.push({ name: cfg.name, picks, degraded });
  console.log(`[${cfg.name}] 候选 ${items.length} 条，入选 ${picks.length} 条${degraded ? '（降级）' : ''}`);
}

const existing = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md')).sort();
const todayFile = new URL(`${today}.md`, CONTENT_DIR);
let number = existing.length + 1;
if (existsSync(todayFile)) {
  const m = readFileSync(todayFile, 'utf8').match(/^issue: (\d+)$/m);
  if (m) number = Number(m[1]);
}
writeFileSync(todayFile, renderIssue({ number, date: today, sections, failedSources }));
console.log(`已生成第 ${number} 期（${today}），不可用源 ${failedSources.length} 个`);
