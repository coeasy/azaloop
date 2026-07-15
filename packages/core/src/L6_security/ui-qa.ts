/**
 * Headless UI QA scaffold (P3-1 / gstack Playwright inspired).
 *
 * Does not hard-depend on Playwright at install time. When playwright is
 * available it runs a smoke navigation; otherwise returns a structured
 * skip with install instructions — still integrable into aza_quality.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface UiQaResult {
  ran: boolean;
  passed: boolean;
  skipped: boolean;
  reason: string;
  url?: string;
  screenshot?: string;
  aria_hint?: string;
}

export interface UiQaOptions {
  projectRoot: string;
  url?: string;
  outDir?: string;
}

function playwrightAvailable(): boolean {
  try {
    require.resolve('playwright');
    return true;
  } catch {
    try {
      require.resolve('@playwright/test');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Run UI QA smoke. Prefer env AZA_UI_QA_URL or options.url (default http://127.0.0.1:3000).
 */
export async function runUiQa(options: UiQaOptions): Promise<UiQaResult> {
  const url = options.url || process.env.AZA_UI_QA_URL || 'http://127.0.0.1:3000';
  const outDir = options.outDir || path.join(options.projectRoot, '.aza', 'ui-qa');
  fs.mkdirSync(outDir, { recursive: true });

  if (process.env.AZA_UI_QA !== 'true' && !options.url && !process.env.AZA_UI_QA_URL) {
    return {
      ran: false,
      passed: true,
      skipped: true,
      reason: 'UI QA idle — set AZA_UI_QA=true or pass url to enable',
    };
  }

  if (!playwrightAvailable()) {
    const marker = path.join(outDir, 'SKIPPED.md');
    fs.writeFileSync(
      marker,
      `# UI QA skipped\n\nInstall: \`pnpm add -D playwright && npx playwright install chromium\`\nThen set AZA_UI_QA=true\n`,
      'utf8',
    );
    return {
      ran: false,
      passed: true,
      skipped: true,
      reason: 'playwright not installed — wrote .aza/ui-qa/SKIPPED.md',
      url,
    };
  }

  // Lightweight node script via npx playwright to avoid bundling browser APIs here
  const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(process.env.QA_URL, { timeout: 15000, waitUntil: 'domcontentloaded' });
    const shot = process.env.QA_SHOT;
    await page.screenshot({ path: shot, fullPage: false });
    const aria = await page.locator('body').ariaSnapshot?.() ?? await page.content();
    require('fs').writeFileSync(process.env.QA_ARIA, String(aria).slice(0, 8000));
    console.log('UI_QA_OK');
  } catch (e) {
    console.error('UI_QA_FAIL', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
`;
  const scriptPath = path.join(outDir, 'run-ui-qa.cjs');
  const shot = path.join(outDir, 'screenshot.png');
  const ariaPath = path.join(outDir, 'aria.txt');
  fs.writeFileSync(scriptPath, script, 'utf8');

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: options.projectRoot,
    env: { ...process.env, QA_URL: url, QA_SHOT: shot, QA_ARIA: ariaPath },
    encoding: 'utf8',
    timeout: 60000,
  });

  const ok = result.status === 0 && /UI_QA_OK/.test(result.stdout || '');
  return {
    ran: true,
    passed: ok,
    skipped: false,
    reason: ok ? 'Playwright smoke navigation passed' : `UI QA failed: ${result.stderr || result.stdout || 'unknown'}`,
    url,
    screenshot: fs.existsSync(shot) ? shot : undefined,
    aria_hint: fs.existsSync(ariaPath) ? fs.readFileSync(ariaPath, 'utf8').slice(0, 500) : undefined,
  };
}
