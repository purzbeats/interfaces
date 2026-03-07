/**
 * Playwright performance profiler for UNIFORM MODE.
 *
 * Loads every element type in uniform mode (all tiles = same element)
 * at 1920x1080, measures per-frame work time over ~2s, then outputs
 * a performance report. This catches elements that are fine solo but
 * choke when 10-15 instances run simultaneously.
 *
 * Run:  npx playwright test tests/perf/profile-uniform.spec.ts
 *
 * Env:
 *   PERF_FILTER=cellular  — only profile elements matching this substring
 *   PERF_SETTLE=3000      — warmup ms (default 3000, needs time for deferred builds + timeline activation)
 *   PERF_MEASURE=3000     — measurement window ms (default 3000)
 *   PERF_MERGE=path.json  — merge with previous results (skip already-profiled)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 60fps budget for uniform mode (multiple elements = more lenient than solo 120fps)
const BUDGET_MS = 16.67;

interface UniformPerf {
  name: string;
  avgWorkMs: number;
  p95WorkMs: number;
  maxWorkMs: number;
  headroom: number;     // % of 60fps budget remaining
  frameCount: number;
  rating: string;
}

function getElementNames(): string[] {
  const elemDir = path.join(__dirname, '..', '..', 'src', 'elements');
  const files = fs.readdirSync(elemDir).filter(f => f.endsWith('.ts'));
  const names: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(elemDir, file), 'utf-8');
    const match = content.match(/name:\s*'([^']+)'/);
    if (match) {
      const name = match[1];
      if (name !== 'panel' && name !== 'separator') {
        names.push(name);
      }
    }
  }

  return names.sort();
}

function rateElement(avgWorkMs: number, p95WorkMs: number): string {
  // Budget is 16.67ms (60fps) since we're running many instances
  if (avgWorkMs <= 8.33 && p95WorkMs <= 12)  return 'A';  // 120fps — great even in uniform
  if (avgWorkMs <= 12   && p95WorkMs <= 18)  return 'B';  // 80fps — comfortable
  if (avgWorkMs <= 16.67 && p95WorkMs <= 25) return 'C';  // 60fps — acceptable
  return 'F';                                              // <60fps — problem
}

function formatReport(results: UniformPerf[]): string {
  const sorted = [...results].sort((a, b) => b.avgWorkMs - a.avgWorkMs);

  const lines: string[] = [];
  lines.push('');
  lines.push('='.repeat(100));
  lines.push('  UNIFORM MODE PERFORMANCE REPORT  —  1920x1080  —  budget: 16.67ms (60fps)');
  lines.push('='.repeat(100));
  lines.push('');

  const counts = { A: 0, B: 0, C: 0, F: 0 };
  for (const r of sorted) counts[r.rating as keyof typeof counts]++;
  lines.push(`  Summary:  A: ${counts.A} (120fps)  |  B: ${counts.B} (80fps)  |  C: ${counts.C} (60fps)  |  F: ${counts.F} (<60fps)  |  Total: ${sorted.length}`);
  lines.push('');

  const header =
    '  ' +
    'Element'.padEnd(35) +
    'Avg ms'.padStart(9) +
    ' P95 ms'.padStart(9) +
    ' Max ms'.padStart(9) +
    'Headroom'.padStart(10) +
    ' Frames'.padStart(8) +
    '  Grade';
  lines.push(header);
  lines.push('  ' + '-'.repeat(95));

  for (const r of sorted) {
    const flag = r.rating === 'F' ? '  <<<' : '';
    const headroomStr = `${r.headroom.toFixed(0)}%`;
    const line =
      '  ' +
      r.name.padEnd(35) +
      r.avgWorkMs.toFixed(2).padStart(9) +
      r.p95WorkMs.toFixed(2).padStart(9) +
      r.maxWorkMs.toFixed(1).padStart(9) +
      headroomStr.padStart(10) +
      String(r.frameCount).padStart(8) +
      '  ' +
      r.rating +
      flag;
    lines.push(line);
  }

  lines.push('');
  lines.push('  Grading (per-frame work time — all tiles same element):');
  lines.push('    A: avg<=8.3ms (120fps great)   |  B: avg<=12ms (80fps comfortable)');
  lines.push('    C: avg<=16.7ms (60fps ok)      |  F: >16.7ms (<60fps problem)');
  lines.push('='.repeat(100));
  lines.push('');

  return lines.join('\n');
}

test('profile all elements in uniform mode', async ({ page }) => {
  test.setTimeout(0);

  const filter = process.env.PERF_FILTER || '';
  const settleMs = parseInt(process.env.PERF_SETTLE || '3000', 10);
  const measureMs = parseInt(process.env.PERF_MEASURE || '3000', 10);
  const mergeFrom = process.env.PERF_MERGE || '';

  let names = getElementNames();
  expect(names.length).toBeGreaterThan(50);

  // Load previous results if merging
  let previousResults: UniformPerf[] = [];
  if (mergeFrom && fs.existsSync(mergeFrom)) {
    previousResults = JSON.parse(fs.readFileSync(mergeFrom, 'utf-8'));
    const profiled = new Set(previousResults.filter(r => r.avgWorkMs < 900).map(r => r.name));
    names = names.filter(n => !profiled.has(n));
    console.log(`Merging with ${mergeFrom}: ${profiled.size} already profiled, ${names.length} remaining`);
  }

  if (filter) {
    names = names.filter(n => n.includes(filter));
    console.log(`Filter "${filter}" matched ${names.length} elements`);
  }

  console.log(`Profiling ${names.length} elements in uniform mode (settle: ${settleMs}ms, measure: ${measureMs}ms)\n`);

  const results: UniformPerf[] = [...previousResults.filter(r => r.avgWorkMs < 900)];

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const progress = `[${String(i + 1).padStart(3)}/${names.length}]`;

    try {
      // Navigate with uniform param — all tiles become this element
      await page.goto(`/?uniform=${name}&seed=42`, { waitUntil: 'domcontentloaded' });

      // Wait for elements to build and settle
      await page.waitForTimeout(settleMs);

      // Clear perf buffer for clean measurement
      await page.evaluate(() => {
        (window as any).__perfFrames.length = 0;
      });

      // Measure steady-state performance
      await page.waitForTimeout(measureMs);

      // Collect work times
      const workTimes: number[] = await page.evaluate(() => {
        return [...(window as any).__perfFrames] as number[];
      });

      const times = workTimes.length > 2 ? workTimes.slice(1) : (workTimes.length > 0 ? workTimes : [16.67]);
      times.sort((a, b) => a - b);

      const avgWorkMs = times.reduce((a, b) => a + b, 0) / times.length;
      const p95Idx = Math.floor(times.length * 0.95);
      const p95WorkMs = times[p95Idx] || times[times.length - 1] || 0;
      const maxWorkMs = times[times.length - 1] || 0;
      const headroom = ((BUDGET_MS - avgWorkMs) / BUDGET_MS) * 100;

      const rating = rateElement(avgWorkMs, p95WorkMs);

      results.push({
        name,
        avgWorkMs,
        p95WorkMs,
        maxWorkMs,
        headroom,
        frameCount: times.length,
        rating,
      });

      const marker = rating === 'F' ? ' !!!' : '';
      console.log(`${progress} ${name.padEnd(32)} avg:${avgWorkMs.toFixed(1).padStart(6)}ms  p95:${p95WorkMs.toFixed(1).padStart(6)}ms  [${rating}]${marker}`);
    } catch (err) {
      console.error(`${progress} ${name}: FAILED — ${(err as Error).message}`);
      results.push({ name, avgWorkMs: 999, p95WorkMs: 999, maxWorkMs: 999, headroom: -999, frameCount: 0, rating: 'F' });
    }
  }

  // Output report
  const report = formatReport(results);
  console.log(report);

  // Save files
  const reportDir = path.join(__dirname, '..', '..');
  const reportPath = path.join(reportDir, 'perf-uniform-report.txt');
  const jsonPath = path.join(reportDir, 'perf-uniform-report.json');
  fs.writeFileSync(reportPath, report);
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Saved: ${reportPath}`);
  console.log(`Saved: ${jsonPath}`);

  // Summary warnings
  const bad = results.filter(r => r.rating === 'F');
  if (bad.length > 0) {
    console.log(`\n  FAILING (<60fps): ${bad.length} elements choke in uniform mode:`);
    for (const b of bad) {
      console.log(`    ${b.name}: ${b.avgWorkMs.toFixed(1)}ms avg (${b.headroom.toFixed(0)}% headroom)`);
    }
  }
  const borderline = results.filter(r => r.rating === 'C');
  if (borderline.length > 0) {
    console.log(`\n  BORDERLINE (60fps): ${borderline.length} elements at minimum:`);
    for (const b of borderline) {
      console.log(`    ${b.name}: ${b.avgWorkMs.toFixed(1)}ms avg`);
    }
  }
});
