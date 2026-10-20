import { appendFileSync } from 'node:fs';

// Keep this report content-free: never retain picks, summaries, trend text,
// source URLs, or upstream errors. Only section names and aggregate counts leave here.
export function evaluateHealth({ sections = [], trend, failedSources = [] } = {}) {
  let total = 0;
  let summarized = 0;
  const degradedSections = [];
  for (const section of sections) {
    const picks = section.picks ?? [];
    total += picks.length;
    summarized += picks.filter((pick) =>
      typeof pick.summary === 'string' && pick.summary.trim().length > 0,
    ).length;
    if (section.degraded) degradedSections.push(String(section.name ?? 'Unnamed section'));
  }
  const missing = total - summarized;
  const failedSourceCount = failedSources.length;
  const reasons = [];
  const lowCoverage = total > 0 && summarized * 5 < total * 4;
  if (degradedSections.length) reasons.push(`${degradedSections.length} section(s) explicitly degraded`);
  if (total === 0) reasons.push('No selected items');
  if (lowCoverage) reasons.push(`Summary coverage below 80% (${summarized}/${total})`);
  if (missing > 0) reasons.push(`${missing} item(s) missing summaries`);
  if (total > 0 && !(typeof trend === 'string' && trend.trim())) reasons.push('Trend unavailable');
  if (failedSourceCount > 0) reasons.push(`${failedSourceCount} source(s) failed`);
  const status = degradedSections.length > 0 || total === 0 || lowCoverage
    ? 'degraded'
    : reasons.length > 0 ? 'warning' : 'healthy';
  return { status, total, summarized, missing, degradedSections, failedSourceCount, reasons };
}

// Workflow-command data escaping must escape percent first. Names/reasons only
// appear in command data, never in annotation properties or output keys/values.
const escapeCommandData = (value) => String(value)
  .replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeTableCell = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('\\', '\\\\').replace(/([`*_\[\]])/g, '\\$1')
  .replaceAll('|', '&#124;').replace(/\r\n|\r|\n/g, '<br>');

// Synchronous appends finish before run-digest's explicit process.exit(0).
// env, paths, writer and logger can all be supplied without touching the real CI env.
export function reportHealth(report, {
  env = process.env,
  summaryPath = env.GITHUB_STEP_SUMMARY,
  outputPath = env.GITHUB_OUTPUT,
  appendFile = appendFileSync,
  log = console.log,
} = {}) {
  const { status, total, summarized, missing, degradedSections, failedSourceCount, reasons } = report;
  if (summaryPath) {
    const rows = [
      ['Status', status],
      ['Selected items', total],
      ['Summarized items', summarized],
      ['Missing summaries', missing],
      ['Degraded sections', degradedSections.length],
      ['Failed sources', failedSourceCount],
    ];
    const details = [
      ['Degraded section names', degradedSections.join('; ') || 'None'],
      ['Reasons', reasons.join('; ') || 'None'],
    ];
    appendFile(summaryPath, [
      '## Digest summary health', '', '| Metric | Value |', '| --- | --- |',
      ...[...rows, ...details].map(([key, value]) => `| ${key} | ${escapeTableCell(value)} |`),
      '', '',
    ].join('\n'), 'utf8');
  }
  if (outputPath) {
    appendFile(outputPath,
      `health_status=${status}\nsummary_total=${total}\nsummary_count=${summarized}\n`, 'utf8');
  }
  if (status !== 'healthy') {
    const message = [
      `Digest summary health: ${status}; total=${total}; summarized=${summarized}; missing=${missing}`,
      ...reasons,
      ...(degradedSections.length ? [`Degraded sections: ${degradedSections.join('; ')}`] : []),
    ].join('; ');
    log(`::${status === 'degraded' ? 'error' : 'warning'}::${escapeCommandData(message)}`);
  }
  return report;
}
