export async function buildTrend(chat, sections) {
  const lines = sections.flatMap((s) => s.picks.map((p) => `[${s.name}] ${p.title}：${p.summary}`));
  if (lines.length === 0) return null;
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      const text = (
        await chat([
          { role: 'system', content: '你是中文技术编辑，只输出正文段落，不加标题和列表。' },
          {
            role: 'user',
            content: `根据今天简报的全部条目，写 3-5 句中文总览：提炼今天的 1-2 条主线，点出值得关注的共性或分歧。条目：\n${lines.join('\n')}`,
          },
        ])
      ).trim();
      if (text) return text;
    } catch (e) {
      console.error(`[今日趋势] 第 ${tries + 1} 次尝试失败：${e.message}`);
    }
  }
  return null;
}
