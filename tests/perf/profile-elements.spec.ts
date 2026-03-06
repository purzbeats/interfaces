/**
 * Playwright performance profiler for all visual elements.
 *
 * Navigates to each element in fullscreen showcase mode at 1920x1080,
 * measures per-frame work time (update + render cost) over ~2s, then
 * outputs a performance report with ratings.
 *
 * Measures actual frame work cost, not RAF interval (which is vsync-capped).
 * An element that takes 4ms per frame can run at 250fps — well within the
 * 8.33ms budget for 120fps.
 *
 * Run:  npx playwright test tests/perf/profile-elements.spec.ts
 *
 * Env:
 *   PERF_FILTER=cellular  — only profile elements matching this substring
 *   PERF_SETTLE=300       — warmup ms (default 300)
 *   PERF_MEASURE=1500     — measurement window ms (default 1500)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 120fps budget = 8.33ms per frame
const BUDGET_MS = 8.33;

interface ElementPerf {
  name: string;
  startupMs: number;
  avgWorkMs: number;    // average frame work time
  p95WorkMs: number;    // 95th percentile work time
  maxWorkMs: number;    // worst frame work time
  headroom: number;     // % of 120fps budget remaining (100 = free, 0 = at limit, <0 = over)
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

async function measureElement(
  page: import('@playwright/test').Page,
  elementName: string,
  settleMs: number,
  measureMs: number,
): Promise<{ startupMs: number; workTimes: number[] }> {
  // Clear perf buffer, navigate to element
  await page.goto(`/?element=${elementName}&view=full`, { waitUntil: 'domcontentloaded' });

  // Wait for settle period (element builds, first frames render)
  await page.waitForTimeout(settleMs);

  // Clear the perf buffer so we only measure steady-state
  await page.evaluate(() => {
    (window as any).__perfFrames.length = 0;
  });

  // Let it run for the measurement window
  await page.waitForTimeout(measureMs);

  // Collect the work times
  const workTimes: number[] = await page.evaluate(() => {
    return [...(window as any).__perfFrames] as number[];
  });

  return { startupMs: settleMs, workTimes: workTimes.length > 0 ? workTimes : [16.67] };
}

function rateElement(avgWorkMs: number, p95WorkMs: number): string {
  // User targets:  120fps = perfect, 90fps = ok, 60fps = pass, <60fps = bad
  // Budget:  120fps → 8.33ms, 90fps → 11.1ms, 60fps → 16.67ms
  if (avgWorkMs <= 8.33 && p95WorkMs <= 11) return 'A';   // 120fps — perfect
  if (avgWorkMs <= 11.1 && p95WorkMs <= 16) return 'B';   // 90fps — ok
  if (avgWorkMs <= 16.67 && p95WorkMs <= 25) return 'C';  // 60fps — pass
  return 'F';                                              // <60fps — bad
}

function formatReport(results: ElementPerf[]): string {
  const sorted = [...results].sort((a, b) => b.avgWorkMs - a.avgWorkMs); // worst first

  const lines: string[] = [];
  lines.push('');
  lines.push('='.repeat(110));
  lines.push('  ELEMENT PERFORMANCE REPORT  —  1920x1080 fullscreen  —  budget: 8.33ms (120fps)');
  lines.push('='.repeat(110));
  lines.push('');

  const counts = { A: 0, B: 0, C: 0, F: 0 };
  for (const r of sorted) counts[r.rating as keyof typeof counts]++;
  lines.push(`  Summary:  A: ${counts.A} (120fps)  |  B: ${counts.B} (90fps)  |  C: ${counts.C} (60fps)  |  F: ${counts.F} (<60fps)  |  Total: ${sorted.length}`);
  lines.push('');

  const header =
    '  ' +
    'Element'.padEnd(35) +
    'Avg ms'.padStart(9) +
    ' P95 ms'.padStart(9) +
    ' Max ms'.padStart(9) +
    'Headroom'.padStart(10) +
    ' Frames'.padStart(8) +
    ' Startup'.padStart(9) +
    '  Grade';
  lines.push(header);
  lines.push('  ' + '-'.repeat(105));

  for (const r of sorted) {
    const flag = r.rating === 'F' ? '  <<<' : '';
    const headroomStr = r.headroom >= 0 ? `${r.headroom.toFixed(0)}%` : `${r.headroom.toFixed(0)}%`;
    const line =
      '  ' +
      r.name.padEnd(35) +
      r.avgWorkMs.toFixed(2).padStart(9) +
      r.p95WorkMs.toFixed(2).padStart(9) +
      r.maxWorkMs.toFixed(1).padStart(9) +
      headroomStr.padStart(10) +
      String(r.frameCount).padStart(8) +
      (r.startupMs.toFixed(0) + 'ms').padStart(9) +
      '  ' +
      r.rating +
      flag;
    lines.push(line);
  }

  lines.push('');
  lines.push('  Grading (per-frame work time → target FPS):');
  lines.push('    A: avg<=8.3ms (120fps perfect)  |  B: avg<=11.1ms (90fps ok)');
  lines.push('    C: avg<=16.7ms (60fps pass)     |  F: >16.7ms (<60fps bad)');
  lines.push('='.repeat(110));
  lines.push('');

  return lines.join('\n');
}

test('profile all elements', async ({ page }) => {
  test.setTimeout(0); // no timeout

  const filter = process.env.PERF_FILTER || '';
  const settleMs = parseInt(process.env.PERF_SETTLE || '300', 10);
  const measureMs = parseInt(process.env.PERF_MEASURE || '1500', 10);
  const mergeFrom = process.env.PERF_MERGE || ''; // path to previous JSON to merge with

  let names = getElementNames();
  expect(names.length).toBeGreaterThan(50);

  // Load previous results if merging — skip already-profiled elements
  let previousResults: ElementPerf[] = [];
  if (mergeFrom && fs.existsSync(mergeFrom)) {
    previousResults = JSON.parse(fs.readFileSync(mergeFrom, 'utf-8'));
    const profiled = new Set(previousResults.filter(r => r.avgWorkMs < 900).map(r => r.name));
    const before = names.length;
    names = names.filter(n => !profiled.has(n));
    console.log(`Merging with ${mergeFrom}: ${profiled.size} already profiled, ${names.length} remaining`);
  }

  if (filter) {
    names = names.filter(n => n.includes(filter));
    console.log(`Filter "${filter}" matched ${names.length} elements`);
  }

  console.log(`Profiling ${names.length} elements (settle: ${settleMs}ms, measure: ${measureMs}ms)\n`);

  const results: ElementPerf[] = [...previousResults.filter(r => r.avgWorkMs < 900)];

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const progress = `[${String(i + 1).padStart(3)}/${names.length}]`;

    try {
      const { startupMs, workTimes } = await measureElement(page, name, settleMs, measureMs);

      // Filter out outlier first frame
      const times = workTimes.length > 2 ? workTimes.slice(1) : workTimes;
      times.sort((a, b) => a - b);

      const avgWorkMs = times.reduce((a, b) => a + b, 0) / times.length;
      const p95Idx = Math.floor(times.length * 0.95);
      const p95WorkMs = times[p95Idx] || times[times.length - 1] || 0;
      const maxWorkMs = times[times.length - 1] || 0;
      const headroom = ((BUDGET_MS - avgWorkMs) / BUDGET_MS) * 100;

      const rating = rateElement(avgWorkMs, p95WorkMs);

      results.push({
        name,
        startupMs,
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
      results.push({ name, startupMs: -1, avgWorkMs: 999, p95WorkMs: 999, maxWorkMs: 999, headroom: -999, frameCount: 0, rating: 'F' });
    }
  }

  // Output report
  const report = formatReport(results);
  console.log(report);

  // Save files
  const reportDir = path.join(__dirname, '..', '..');
  const reportPath = path.join(reportDir, 'perf-report.txt');
  const jsonPath = path.join(reportDir, 'perf-report.json');
  fs.writeFileSync(reportPath, report);
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Saved: ${reportPath}`);
  console.log(`Saved: ${jsonPath}`);

  // Summary warnings
  const bad = results.filter(r => r.rating === 'F');
  if (bad.length > 0) {
    console.log(`\n  FAILING (<60fps): ${bad.length} elements need optimization:`);
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
