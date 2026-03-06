import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

test.describe('Editor Overhaul', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/?seed=42`);
    await page.waitForTimeout(1500); // let engine boot

    // Press E to open editor
    await page.keyboard.press('e');
    await page.waitForTimeout(500);

    // Click "Start blank" in the entry prompt
    const blankBtn = page.locator('button', { hasText: 'Start blank' });
    if (await blankBtn.isVisible({ timeout: 2000 })) {
      await blankBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('editor opens with toolbar, palette, and status bar', async ({ page }) => {
    await page.screenshot({ path: 'test-results/editor-baseline.png', fullPage: true });

    // Toolbar should be visible
    const toolbar = page.locator('#editor-overlay div').first();
    await expect(toolbar).toBeVisible();

    // Palette panel should be visible
    const palette = page.locator('#editor-palette');
    await expect(palette).toBeVisible();
  });

  test('search filters palette elements', async ({ page }) => {
    // Type in search box
    const search = page.locator('#editor-palette-search');
    await expect(search).toBeVisible();
    await search.fill('binary');
    await page.waitForTimeout(200);

    // Should show filtered results
    const tiles = page.locator('#editor-palette-grid [data-element-type]');
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20); // filtered down from 380+

    // All visible tiles should contain "binary"
    for (let i = 0; i < count; i++) {
      const type = await tiles.nth(i).getAttribute('data-element-type');
      expect(type).toContain('binary');
    }

    await page.screenshot({ path: 'test-results/editor-search.png', fullPage: true });
  });

  test('can place element and see properties panel', async ({ page }) => {
    // Click an element in the palette to place it
    const tile = page.locator('[data-element-type="binary-stream"]');
    await tile.click();
    await page.waitForTimeout(500);

    // Properties panel should appear
    const props = page.locator('#editor-properties');
    await expect(props).toBeVisible();

    // Should show element type
    const typeSelect = props.locator('select');
    await expect(typeSelect).toBeVisible();

    await page.screenshot({ path: 'test-results/editor-properties.png', fullPage: true });
  });

  test('can duplicate element with Ctrl+D', async ({ page }) => {
    // Place an element
    const tile = page.locator('[data-element-type="clock-display"]');
    await tile.click();
    await page.waitForTimeout(500);

    // Duplicate it
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'test-results/editor-duplicate.png', fullPage: true });
  });

  test('arrow keys nudge selected element', async ({ page }) => {
    // Place an element
    const tile = page.locator('[data-element-type="binary-stream"]');
    await tile.click();
    await page.waitForTimeout(500);

    // Get initial position from properties
    const xInput = page.locator('#editor-prop-x');
    const initialX = await xInput.inputValue();

    // Nudge right
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    const newX = await xInput.inputValue();
    expect(parseFloat(newX)).toBeGreaterThan(parseFloat(initialX));
  });

  test('undo/redo works', async ({ page }) => {
    // Place an element
    const tile = page.locator('[data-element-type="binary-stream"]');
    await tile.click();
    await page.waitForTimeout(500);

    // Should have 1 element
    const statusText = await page.locator('#editor-status-text').textContent();
    expect(statusText).toContain('1 element');

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // Should have 0 elements
    const afterUndo = await page.locator('#editor-status-text').textContent();
    expect(afterUndo).toContain('0 element');

    // Redo
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(500);

    const afterRedo = await page.locator('#editor-status-text').textContent();
    expect(afterRedo).toContain('1 element');
  });

  test('grid overlay toggles with G key', async ({ page }) => {
    // Grid should be hidden initially
    const grid = page.locator('#editor-grid-overlay');
    await expect(grid).toBeHidden();

    // Toggle grid
    await page.keyboard.press('g');
    await page.waitForTimeout(200);

    await expect(grid).toBeVisible();
    await page.screenshot({ path: 'test-results/editor-grid.png', fullPage: true });

    // Toggle off
    await page.keyboard.press('g');
    await page.waitForTimeout(200);
    await expect(grid).toBeHidden();
  });

  test('context menu on right-click', async ({ page }) => {
    // Place an element
    const tile = page.locator('[data-element-type="binary-stream"]');
    await tile.click();
    await page.waitForTimeout(500);

    // Right-click on the selection outline
    const outline = page.locator('[data-editor-outline]');
    await outline.click({ button: 'right' });
    await page.waitForTimeout(200);

    // Context menu should appear
    const menu = page.locator('#editor-context-menu');
    await expect(menu).toBeVisible();
    await page.screenshot({ path: 'test-results/editor-context-menu.png', fullPage: true });
  });

  test('help dialog shows on ? key', async ({ page }) => {
    await page.keyboard.press('?');
    await page.waitForTimeout(200);

    const help = page.locator('#editor-help-dialog');
    await expect(help).toBeVisible();
    await page.screenshot({ path: 'test-results/editor-help.png', fullPage: true });

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(help).toBeHidden();
  });

  test('layout rename via status bar', async ({ page }) => {
    const nameEl = page.locator('#editor-layout-name');
    await expect(nameEl).toBeVisible();
    await nameEl.click();
    await page.waitForTimeout(200);

    // Should show input
    const nameInput = page.locator('#editor-layout-name-input');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('My Custom Layout');
    await nameInput.press('Enter');
    await page.waitForTimeout(200);

    // Name should be updated
    const updatedName = await nameEl.textContent();
    expect(updatedName).toContain('My Custom Layout');
  });

  test('element type swap via properties panel', async ({ page }) => {
    // Place a binary-stream
    const tile = page.locator('[data-element-type="binary-stream"]');
    await tile.click();
    await page.waitForTimeout(500);

    // Change type in properties panel
    const typeSelect = page.locator('#editor-prop-type');
    await typeSelect.selectOption('clock-display');
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'test-results/editor-swap-type.png', fullPage: true });
  });

  test('palette selector in toolbar', async ({ page }) => {
    const palSelect = page.locator('#editor-palette-select');
    await expect(palSelect).toBeVisible();

    // Change palette
    await palSelect.selectOption('amber');
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'test-results/editor-palette-change.png', fullPage: true });
  });

  test('full workflow: place, move, resize, duplicate, save', async ({ page }) => {
    // Place first element
    await page.locator('[data-element-type="binary-stream"]').click();
    await page.waitForTimeout(300);

    // Nudge it
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // Duplicate
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);

    // Place another element
    await page.locator('[data-element-type="clock-display"]').click();
    await page.waitForTimeout(300);

    // Save
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'test-results/editor-workflow.png', fullPage: true });
  });
});
