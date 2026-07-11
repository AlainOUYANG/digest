export function escapeMd(s) {
  return String(s).replace(/([[\]])/g, '\\$1');
}

export function renderIssue({ number, date, sections, failedSources }) {
  const lines = [
    '---',
    `title: 第 ${number} 期`,
    `date: ${date}`,
    `issue: ${number}`,
    `unavailableSources: ${JSON.stringify(failedSources)}`,
    '---',
    '',
  ];
  for (const s of sections) {
    lines.push(`## ${s.name}`, '');
    if (s.picks.length === 0) {
      lines.push('本栏目今日无入选内容。', '');
      continue;
    }
    if (s.degraded) lines.push('（本期摘要服务不可用，仅提供标题与链接。）', '');
    for (const p of s.picks) {
      lines.push(`- **[${escapeMd(p.title)}](${p.link})** — ${escapeMd(p.author || p.source)}`);
      if (p.summary) lines.push(`  ${p.summary}`);
    }
    lines.push('');
  }
  if (failedSources.length > 0) {
    lines.push(`> 本期有 ${failedSources.length} 个源不可用：${failedSources.map(escapeMd).join('、')}。`, '');
  }
  return lines.join('\n');
}
