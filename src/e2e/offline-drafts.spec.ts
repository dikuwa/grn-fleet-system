import { test, expect } from '@playwright/test';

test.describe('Offline Drafts', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the fuel entry page (or login first)
    await page.goto('/dashboard/fuel/new');
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
  });

  test('shows draft save button on fuel entry form', async ({ page }) => {
    // Verify the fuel entry form loads with the save draft button
    await expect(page.locator('button:has-text("Save Draft")').first()).toBeVisible({ timeout: 10000 });

    // Verify the offline status indicator is present (shows as online initially)
    await expect(page.locator('[data-testid="offline-indicator"]')).toBeVisible();
  });

  test('saves draft when offline and form data is entered', async ({ page, context }) => {
    // Fill in the fuel entry form
    await page.locator('input[name="litres"]').fill('45.5');
    await page.locator('input[name="amount"]').fill('850.00');
    await page.locator('input[name="stationName"]').fill('Test Station');

    // Set the browser to offline mode
    await context.setOffline(true);

    // Try to submit - should save as offline draft
    await page.locator('button:has-text("Save Draft")').first().click();

    // Verify the offline badge is visible and shows unsynced count
    await expect(page.locator('[data-testid="offline-indicator"]')).toContainText(/unsynced|offline/i);

    // Verify a toast or confirmation message appears
    await expect(page.locator('text=Saved as draft').or(page.locator('text=saved locally'))).toBeVisible({ timeout: 5000 });

    // Switch back to online
    await context.setOffline(false);
  });

  test('shows offline banner when browser goes offline', async ({ page, context }) => {
    // Initially online
    await expect(page.locator('[data-testid="offline-indicator"]')).toBeVisible();

    // Go offline
    await context.setOffline(true);

    // Verify offline status indicator updates
    await expect(page.locator('[data-testid="offline-indicator"]')).toContainText(/offline/i, { timeout: 5000 });

    // The fuel entry form should show an offline warning banner
    await expect(page.locator('text=You are offline').or(page.locator('text=offline'))).toBeVisible({ timeout: 5000 });
  });

  test('offline indicator shows draft count in dashboard shell', async ({ page }) => {
    // Navigate to the main dashboard
    await page.goto('/dashboard');

    // The OfflineIndicator should be visible in the dashboard shell
    const indicator = page.locator('[data-testid="offline-indicator"]');
    await expect(indicator).toBeVisible({ timeout: 10000 });
  });
});
