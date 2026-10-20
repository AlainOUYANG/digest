import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateHealth, reportHealth } from '../lib/health.mjs';

const section = (total = 5, summarized = total, extra = {}) => ({
  name: 'AI 技术博客',
  picks: Array.from({ length: total }, (_, i) => ({ summary: i < summarized ? '摘要' : '' })),
  ...extra,
});
const evaluate = (sections, extra = {}) => evaluateHealth({ sections, trend: '趋势', ...extra });

function tempEnv(t) {
  const dir = mkdtempSync(join(tmpdir(), 'digest-health-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { GITHUB_STEP_SUMMARY: join(dir, 'summary.md'), GITHUB_OUTPUT: join(dir, 'output') };
}

test('healthy: complete summaries and trend; evaluator is pure and deterministic', () => {
  const picks = Object.freeze([Object.freeze({ summary: ' 摘要 ' })]);
  const sections = Object.freeze([Object.freeze(section(0, 0, { picks }))]);
  const input = Object.freeze({ sections, trend: '趋势', failedSources: Object.freeze([]) });
  const expected = {
    status: 'healthy', total: 1, summarized: 1, missing: 0,
    degradedSections: [], failedSourceCount: 0, reasons: [],
  };
  assert.deepEqual(evaluateHealth(input), expected);
  assert.deepEqual(evaluateHealth(input), expected);
});

test('partial missing summaries above 80% are warning, not degraded', () => {
  const report = evaluate([section(10, 9)]);
  assert.equal(report.status, 'warning');
  assert.equal(report.total, 10);
  assert.equal(report.summarized, 9);
  assert.equal(report.missing, 1);
  assert.deepEqual(report.reasons, ['1 item(s) missing summaries']);
});

test('total summary outage is degraded even without an explicit flag', () => {
  const report = evaluate([section(5, 0)]);
  assert.equal(report.status, 'degraded');
  assert.equal(report.summarized, 0);
  assert.equal(report.missing, 5);
  assert.ok(report.reasons.includes('Summary coverage below 80% (0/5)'));
});

test('explicit degradation wins even with complete summaries', () => {
  const report = evaluate([section(5, 5, { degraded: true }), section(0, 0, { name: '空栏目' })]);
  assert.equal(report.status, 'degraded');
  assert.deepEqual(report.degradedSections, ['AI 技术博客']);
  assert.ok(report.reasons.includes('1 section(s) explicitly degraded'));
});

test('zero total, empty picks, and default input are degraded, not missing-trend warnings', () => {
  for (const report of [evaluate([]), evaluate([section(0)]), evaluateHealth()]) {
    assert.equal(report.status, 'degraded');
    assert.equal(report.total, 0);
    assert.equal(report.summarized, 0);
    assert.equal(report.missing, 0);
    assert.deepEqual(report.reasons, ['No selected items']);
  }
});

test('coverage below 80% is degraded and computed across all sections', () => {
  const report = evaluate([section(5, 5), section(5, 2, { name: '即刻' })]);
  assert.equal(report.status, 'degraded');
  assert.equal(report.total, 10);
  assert.equal(report.summarized, 7);
  assert.ok(report.reasons.includes('Summary coverage below 80% (7/10)'));
});

test('exactly 80% coverage is warning, not degraded', () => {
  const report = evaluate([section(5, 4)]);
  assert.equal(report.status, 'warning');
  assert.deepEqual(report.reasons, ['1 item(s) missing summaries']);
});

test('global 80% threshold is not a per-section threshold', () => {
  assert.equal(evaluate([section(4), section(1, 0)]).status, 'warning');
});

test('only nonblank strings count as summaries', () => {
  const picks = [' 摘要 ', '', ' \n\t ', null, undefined, 42, {}].map((summary) => ({ summary }));
  const report = evaluate([section(0, 0, { picks })]);
  assert.equal(report.total, 7);
  assert.equal(report.summarized, 1);
  assert.equal(report.missing, 6);
});

test('missing or blank trend with selected items is warning', () => {
  for (const trend of [undefined, null, '', ' \n ']) {
    const report = evaluate([section()], { trend });
    assert.equal(report.status, 'warning');
    assert.deepEqual(report.reasons, ['Trend unavailable']);
  }
});

test('failed sources produce warning counts without exposing source details', () => {
  const failedSources = [{ url: 'https://secret.invalid?token=PRIVATE', error: 'SECRET_ERROR' }];
  const report = evaluate([section()], { failedSources });
  assert.equal(report.status, 'warning');
  assert.equal(report.failedSourceCount, 1);
  assert.deepEqual(report.reasons, ['1 source(s) failed']);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|SECRET_ERROR|secret\.invalid/);
});

test('summary and output files append counts using an isolated env', (t) => {
  const env = tempEnv(t);
  writeFileSync(env.GITHUB_STEP_SUMMARY, 'Previous summary\n');
  writeFileSync(env.GITHUB_OUTPUT, 'previous=value\n');
  const logs = [];
  const report = evaluate([section(5, 4)]);
  assert.equal(reportHealth(report, { env, log: (line) => logs.push(line) }), report);
  const summary = readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8');
  assert.ok(summary.startsWith('Previous summary\n## Digest summary health\n'));
  for (const row of ['| Status | warning |', '| Selected items | 5 |', '| Summarized items | 4 |',
    '| Missing summaries | 1 |', '| Degraded sections | 0 |', '| Failed sources | 0 |']) {
    assert.ok(summary.includes(row), row);
  }
  assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'),
    'previous=value\nhealth_status=warning\nsummary_total=5\nsummary_count=4\n');
  assert.equal(logs.length, 1);
  assert.ok(logs[0].startsWith('::warning::'));
});

test('healthy reports do not emit warning/error annotations', (t) => {
  const env = tempEnv(t);
  reportHealth(evaluate([section()]), { env, log: () => assert.fail('unexpected annotation') });
  assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'),
    'health_status=healthy\nsummary_total=5\nsummary_count=5\n');
});

test('degraded annotations escape percent/CR/LF and Markdown section names safely', (t) => {
  const env = tempEnv(t);
  const name = 'AI%0A\r\n::warning::injected|[link](url)<script>&*_`';
  const report = evaluate([section(1, 0, { name, degraded: true })], { trend: null });
  const logs = [];
  reportHealth(report, { env, log: (line) => logs.push(line) });
  assert.equal(logs.length, 1);
  assert.ok(logs[0].startsWith('::error::'));
  assert.ok(logs[0].includes('AI%250A%0D%0A::warning::injected'));
  assert.doesNotMatch(logs[0], /[\r\n]/);
  const summary = readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8');
  assert.ok(summary.includes('AI%0A<br>::warning::injected&#124;\\[link\\](url)&lt;script&gt;&amp;\\*\\_\\`'));
  assert.doesNotMatch(summary, /<script>|\r|\n::warning::/);
  assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'),
    'health_status=degraded\nsummary_total=1\nsummary_count=0\n');
});

test('reports never leak item, trend, source content or unrelated env secrets', (t) => {
  const env = { ...tempEnv(t), PRIVATE_TOKEN: 'ENV_SECRET' };
  const report = evaluate([section(0, 0, {
    degraded: true,
    picks: [{ title: 'TITLE_SECRET', summary: 'SUMMARY_SECRET', content: 'CONTENT_SECRET' }],
  })], {
    trend: 'TREND_SECRET',
    failedSources: [{ url: 'URL_SECRET', error: 'ERROR_SECRET' }],
  });
  const logs = [];
  reportHealth(report, { env, log: (line) => logs.push(line) });
  const emitted = JSON.stringify(report) + logs.join('\n')
    + readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8') + readFileSync(env.GITHUB_OUTPUT, 'utf8');
  assert.doesNotMatch(emitted, /(?:ENV|TITLE|SUMMARY|CONTENT|TREND|URL|ERROR)_SECRET/);
});

test('undefined GitHub paths skip writes and injected dependencies work without files', () => {
  const writes = [];
  const logs = [];
  const report = evaluate([section()], { failedSources: ['private'] });
  reportHealth(report, { env: {}, appendFile: () => assert.fail('unexpected write'), log: (s) => logs.push(s) });
  assert.equal(logs.length, 1);
  reportHealth(report, {
    env: {}, summaryPath: 'summary-path', outputPath: 'output-path',
    appendFile: (...args) => writes.push(args), log: () => {},
  });
  assert.equal(writes.length, 2);
  assert.equal(writes[0][0], 'summary-path');
  assert.equal(writes[1][0], 'output-path');
  assert.equal(writes[1][1], 'health_status=warning\nsummary_total=5\nsummary_count=5\n');
  assert.equal(writes[0][2], 'utf8');
});

test('each GitHub file can be configured independently', (t) => {
  const paths = tempEnv(t);
  const report = evaluate([section()]);
  reportHealth(report, { env: { GITHUB_STEP_SUMMARY: paths.GITHUB_STEP_SUMMARY } });
  reportHealth(report, { env: { GITHUB_OUTPUT: paths.GITHUB_OUTPUT } });
  assert.ok(readFileSync(paths.GITHUB_STEP_SUMMARY, 'utf8').includes('| Status | healthy |'));
  assert.ok(readFileSync(paths.GITHUB_OUTPUT, 'utf8').includes('health_status=healthy'));
});
