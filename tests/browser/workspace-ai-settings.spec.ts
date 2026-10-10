import { openAISettings } from './workspace-settings-helper';
import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

async function toggleAnimation(trigger: Locator) {
  const result = await trigger.evaluate(async (element) => {
    const id = element.getAttribute('aria-controls');
    (element as HTMLButtonElement).click();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const panel = document.getElementById(
      id ?? element.getAttribute('aria-controls')!,
    )!;
    const animation = panel
      .getAnimations()
      .find((animation) => animation.playState === 'running');
    const state = {
      panelId: panel.id,
      expanded: element.getAttribute('aria-expanded') === 'true',
    };
    if (!animation) return { ...state, animated: false, between: false };
    const duration = Number(animation.effect!.getComputedTiming().duration);
    animation.currentTime = duration / 2;
    const height = panel.getBoundingClientRect().height;
    const between = height > 0 && height < panel.scrollHeight;
    animation.finish();
    return { ...state, animated: duration > 0, between };
  });
  // Finishing the sampled CSS animation still leaves Base UI's completion
  // callback pending. Wait for its committed panel state before sending keys.
  await expect
    .poll(() =>
      trigger.evaluate((_, id) => {
        const panel = document.getElementById(id);
        return !panel || panel.hidden;
      }, result.panelId),
    )
    .toBe(!result.expanded);
  return { animated: result.animated, between: result.between };
}

for (const base of ['/', '/LocalCut/']) {
  test(`spacious AI settings animate disclosures and preserve input on desktop and phone ${base}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(base);
    await openAISettings(page);
    const dialog = page.getByRole('dialog', {
      name: 'AI connection',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () => (await dialog.boundingBox())!.width)
      .toBeGreaterThanOrEqual(760);
    const providers = dialog.getByRole('button', {
      name: 'Providers & services',
      exact: true,
    });
    expect(await toggleAnimation(providers)).toEqual({
      animated: true,
      between: true,
    });
    await dialog
      .getByRole('button', { name: 'Add provider', exact: true })
      .click();
    const name = dialog.getByLabel('Name', { exact: true });
    await name.fill('Unsaved provider');
    expect(await toggleAnimation(providers)).toEqual({
      animated: true,
      between: true,
    });
    await expect(name).not.toBeVisible();
    await providers.focus();
    await providers.press('Space');
    await expect(name).toHaveValue('Unsaved provider');
    await expect(name).toBeVisible();
    const service = dialog.getByRole('button', {
      name: 'STT · Transcription',
      exact: true,
    });
    await service.scrollIntoViewIfNeeded();
    expect(await toggleAnimation(service)).toEqual({
      animated: true,
      between: true,
    });
    await expect(
      dialog.getByRole('textbox', { name: 'Local Whisper stt route model' }),
    ).toBeDisabled();
    expect(await toggleAnimation(service)).toEqual({
      animated: true,
      between: true,
    });
    await service.focus();
    await service.press('Enter');
    await expect(service).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({
      path: testInfo.outputPath('ai-settings-desktop.png'),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      dialog.getByRole('heading', { name: 'AI connection', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Close', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Done', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      )
      .toBe(true);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath('ai-settings-phone.png'),
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await providers.scrollIntoViewIfNeeded();
    const noMotion = await providers.evaluate(async (element) => {
      const panel = document.getElementById(
        element.getAttribute('aria-controls')!,
      )!;
      (element as HTMLButtonElement).click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return {
        property: getComputedStyle(panel).transitionProperty,
        animations: panel.getAnimations().length,
      };
    });
    expect(noMotion).toEqual({ property: 'none', animations: 0 });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Workspace settings', exact: true }),
    ).toBeFocused();
    await page
      .getByRole('button', { name: 'Workspace settings', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Appearance', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Interface size', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Large (125%)', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Close appearance', exact: true })
      .click();
    await openAISettings(page);
    await expect(dialog).toBeVisible();
    const largeBounds = (await dialog.boundingBox())!;
    expect(largeBounds.y).toBeGreaterThanOrEqual(0);
    expect(largeBounds.y + largeBounds.height).toBeLessThanOrEqual(844);
    expect(largeBounds.x).toBeGreaterThanOrEqual(0);
    expect(largeBounds.x + largeBounds.width).toBeLessThanOrEqual(390);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  });
}
