import { enrichSelectedContent } from './feeds.mjs';

const PLACEHOLDER_SUMMARY = /(?:未提供|没有提供).{0,8}(?:具体)?(?:内容|信息|细节)|具体.{0,12}(?:未详述|未列举)|建议.{0,8}(?:查阅|阅读|查看).{0,8}(?:原文|链接)|值得关注.{0,8}(?:后续|进展)/;

function sanitizeSummary(value) {
  const summary = String(value ?? '').trim();
  return PLACEHOLDER_SUMMARY.test(summary) ? '' : summary;
}

export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('LLM 回复中没有 JSON 数组');
  return JSON.parse(raw.slice(start, end + 1));
}

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
        content: `为每条写 3-4 句中文摘要（120-180 字）：先说讲了什么，再给关键结论或数据，最后一句说为什么值得读。原文很短的条目（如社交动态）提炼核心观点即可，不要硬凑字数。只能总结输入文本明确提供的信息，不得根据标题、作者身份或常识补写事实。证据不足时 summary 返回空字符串，不得写「未提供具体内容」「建议查阅原文」「值得关注后续」等占位话术。只输出 JSON [{"i":序号,"summary":"..."}]：\n${JSON.stringify(chosen.map((c, i) => ({ i, title: c.title, text: (c.content ?? c.snippet).slice(0, 6000) })))}`,
      },
    ]),
  );
  return chosen.map((c, i) => ({
    ...c,
    summary: sanitizeSummary(summaries.find((s) => s.i === i)?.summary),
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
