import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../src/content/issues/', import.meta.url);
const required = ['AI 技术博客', '因果推断与营销科学', '即刻简报'];
const errors = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(new URL(file, dir), 'utf8');
  for (const key of ['title:', 'date:', 'issue:']) {
    if (!new RegExp(`^${key}`, 'm').test(text)) errors.push(`${file}: 缺 frontmatter ${key}`);
  }
  for (const section of required) {
    if (!text.includes(`## ${section}`)) errors.push(`${file}: 缺栏目 ${section}`);
  }
  for (const line of text.split('\n')) {
    if (!line.startsWith('- **[')) continue;
    if (!/\]\(https?:\/\/\S+\)/.test(line)) errors.push(`${file}: 条目缺原文链接：${line.slice(0, 60)}`);
    if (!line.includes(' — ')) errors.push(`${file}: 条目缺署名：${line.slice(0, 60)}`);
  }
}

if (errors.length > 0) {
  console.error('issue contract: FAIL');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('issue contract: PASS');
