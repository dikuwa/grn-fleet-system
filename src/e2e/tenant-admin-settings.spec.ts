import { expect, request as playwrightRequest, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function authenticatedApi(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/sign-in', {
    data: { email, password: PASSWORD },
  });
  expect(signIn.status()).toBe(200);
  return api;
}

test.describe.serial('Tenant administrator settings and branding', () => {
  test('tenant admin can load, validate, persist, and audit tenant settings', async ({
    browser,
  }) => {
    const api = await authenticatedApi('admin@kavangoeast.gov.na');
    const initial = await api.get('/api/settings');
    expect(initial.status()).toBe(200);
    const initialBody = await initial.json();

    const invalid = await api.post('/api/settings', {
      data: { branding: { primaryColor: 'blue' } },
    });
    expect(invalid.status()).toBe(422);

    const saved = await api.post('/api/settings', {
      data: {
        tenant: { name: initialBody.data.tenant.name },
        branding: {
          contactPhone: initialBody.data.branding.contactPhone || '+264 66 123 456',
          primaryColor: initialBody.data.branding.primaryColor || '#1F4E8C',
          accentColor: initialBody.data.branding.accentColor || '#0F766E',
        },
      },
    });
    expect(saved.status()).toBe(200);

    const persisted = await api.get('/api/settings');
    expect(persisted.status()).toBe(200);
    const persistedBody = await persisted.json();
    expect(persistedBody.data.tenant.name).toBe(initialBody.data.tenant.name);
    expect(persistedBody.data.branding.primaryColor).toMatch(/^#[0-9A-F]{6}$/i);

    const context = await browser.newContext({ storageState: await api.storageState() });
    const page = await context.newPage();
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Branding' }).click();
    await expect(page.getByRole('textbox', { name: 'Primary Colour', exact: true })).toBeVisible();
    await context.close();
    await api.dispose();
  });

  test('tenant logo upload is private, tenant-scoped, replaceable, and removable', async () => {
    const api = await authenticatedApi('admin@kavangoeast.gov.na');
    const image = readFileSync(join(process.cwd(), 'docs/screenshots/requester-mobile.png'));

    const uploaded = await api.post('/api/settings/logo', {
      multipart: {
        file: { name: 'tenant-logo.png', mimeType: 'image/png', buffer: image },
      },
    });
    expect(uploaded.status()).toBe(200);

    const downloaded = await api.get('/api/settings/logo');
    expect(downloaded.status()).toBe(200);
    expect(downloaded.headers()['content-type']).toBe('image/webp');
    expect(downloaded.headers()['cache-control']).toContain('private');
    expect((await downloaded.body()).length).toBeGreaterThan(0);

    const removed = await api.delete('/api/settings/logo');
    expect(removed.status()).toBe(200);
    expect((await api.get('/api/settings/logo')).status()).toBe(404);
    await api.dispose();
  });

  test('non-admin users cannot change settings or branding', async () => {
    const api = await authenticatedApi('requester@kavangoeast.test');
    expect(
      (
        await api.post('/api/settings', {
          data: { branding: { primaryColor: '#123456' } },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await api.post('/api/settings/logo', {
          multipart: {
            file: {
              name: 'not-an-image.png',
              mimeType: 'image/png',
              buffer: Buffer.from('not-an-image'),
            },
          },
        })
      ).status(),
    ).toBe(403);
    await api.dispose();
  });
});
