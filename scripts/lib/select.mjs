export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('LLM 回复中没有 JSON 数组');
  return JSON.parse(raw.slice(start, end + 1));
}

async function attempt(chat, section, items) {
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
  const chosen = scored
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, section.topN)
    .map((s) => items[s.i])
    .filter(Boolean);
  if (chosen.length === 0) return [];
  const summaries = extractJson(
    await chat([
      { role: 'system', content: '你是中文技术编辑，只输出 JSON，不输出其他文字。' },
      {
        role: 'user',
        content: `为每条写 1-2 句中文摘要，不复述标题，不超过 80 字，输出 [{"i":序号,"summary":"..."}]：\n${JSON.stringify(chosen.map((c, i) => ({ i, title: c.title, snippet: c.snippet })))}`,
      },
    ]),
  );
  return chosen.map((c, i) => ({ ...c, summary: summaries.find((s) => s.i === i)?.summary ?? '' }));
}

export async function selectAndSummarize(chat, section, items) {
  if (items.length === 0) return { picks: [], degraded: false };
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      return { picks: await attempt(chat, section, items), degraded: false };
    } catch {
      // 重试一次，仍失败则走降级
    }
  }
  const picks = [...items]
    .sort((a, b) => Date.parse(b.isoDate ?? 0) - Date.parse(a.isoDate ?? 0))
    .slice(0, section.topN)
    .map((it) => ({ ...it, summary: '' }));
  return { picks, degraded: true };
}
