import { expect, test } from '@playwright/test';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64',
);

async function signIn(page: import('@playwright/test').Page, username: string) {
  await page.goto('/login');
  await page.getByPlaceholder('Enter your username or email').fill(username);
  await page.getByPlaceholder('Enter your password').fill('changeme');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test('driver licence files upload to storage and Transport Admin can update/approve the submission', async ({ page, context }) => {
  test.setTimeout(120_000);

  await signIn(page, 'driver');

  const meResponse = await page.request.get('/api/drivers/me');
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json();
  const employeeId = me.driver?.employeeId as string | undefined;
  expect(employeeId).toBeTruthy();

  const uniqueSuffix = Date.now().toString();
  const uploadedNumber = `E2E-${uniqueSuffix.slice(-8)}`;
  const correctedNumber = `${uploadedNumber}-OK`;

  const uploadResponse = await page.request.post(`/api/drivers/${employeeId}/licences`, {
    multipart: {
      front: {
        name: `licence-front-${uniqueSuffix}.png`,
        mimeType: 'image/png',
        buffer: PNG_1X1,
      },
      back: {
        name: `licence-back-${uniqueSuffix}.png`,
        mimeType: 'image/png',
        buffer: PNG_1X1,
      },
      licenceNumber: uploadedNumber,
      licenceClass: 'B',
      issueDate: '2026-01-01',
      expiryDate: '2030-12-31',
    },
  });

  expect(uploadResponse.status(), await uploadResponse.text()).toBe(201);
  const upload = await uploadResponse.json();
  const licenceId = upload.data?.id as string | undefined;
  const frontImageKey = upload.data?.frontImageKey as string | undefined;
  const backImageKey = upload.data?.backImageKey as string | undefined;
  expect(licenceId).toBeTruthy();
  expect(frontImageKey).toContain(`tenant/00000000-0000-0000-0000-000000000001/driver-licences/${employeeId}/`);
  expect(backImageKey).toContain(`tenant/00000000-0000-0000-0000-000000000001/driver-licences/${employeeId}/`);
  expect(upload.data?.isActive).toBe(false);
  expect(upload.data?.isVerified).toBe(false);

  const storage = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || 'minioadmin',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || 'minioadmin',
    },
  });
  await expect(
    storage.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME || 'grn-fleet', Key: frontImageKey! })),
  ).resolves.toBeTruthy();
  await expect(
    storage.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME || 'grn-fleet', Key: backImageKey! })),
  ).resolves.toBeTruthy();

  await context.clearCookies();
  await signIn(page, 'transport-admin');

  const approveResponse = await page.request.patch(`/api/drivers/${employeeId}/licences`, {
    data: {
      licenceId,
      action: 'approve',
      corrections: {
        licenceNumber: correctedNumber,
        issueDate: '2026-02-01',
        expiryDate: '2031-12-31',
      },
    },
  });
  expect(approveResponse.status(), await approveResponse.text()).toBe(200);
  expect((await approveResponse.json()).success).toBe(true);

  await context.clearCookies();
  await signIn(page, 'driver');

  const refreshedResponse = await page.request.get('/api/drivers/me');
  expect(refreshedResponse.ok()).toBeTruthy();
  const refreshed = await refreshedResponse.json();
  const updated = refreshed.driver?.licences?.find((licence: { id: string }) => licence.id === licenceId);

  expect(updated).toBeTruthy();
  expect(updated.licenceNumber).toBe(correctedNumber);
  expect(updated.issueDate).toBe('2026-02-01');
  expect(updated.expiryDate).toBe('2031-12-31');
  expect(updated.verificationStatus).toBe('verified');
});
