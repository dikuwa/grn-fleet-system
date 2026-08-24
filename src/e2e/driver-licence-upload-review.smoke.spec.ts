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

test('driver licence upload stays provisional until Transport Admin review, then persists as verified', async ({ page, context }) => {
  // OCR + object-storage cold starts on the remote audit database can exceed
  // two minutes even when the lifecycle is healthy. Keep a finite production-
  // readiness budget, but align it with the other stateful remote E2E flows so
  // a slow first OCR/storage request is not misclassified as a functional
  // failure midway through a versioned licence submission.
  test.setTimeout(300_000);

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
  expect(['awaiting_review', 'needs_correction']).toContain(upload.data?.verificationStatus);

  // A new upload must remain provisional for the driver until an authorised reviewer acts.
  const provisionalResponse = await page.request.get('/api/drivers/me');
  expect(provisionalResponse.ok()).toBeTruthy();
  const provisional = await provisionalResponse.json();
  const provisionalLicence = provisional.driver?.licences?.find((licence: { id: string }) => licence.id === licenceId);
  expect(provisionalLicence).toBeTruthy();
  expect(provisionalLicence.isActive).toBe(false);
  expect(provisionalLicence.verificationStatus).not.toBe('verified');

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

  // The provisional submission must be visible in the tenant-scoped review queue.
  const queueResponse = await page.request.get(`/api/drivers/licences/queue?status=all&q=${encodeURIComponent(uploadedNumber)}`);
  expect(queueResponse.ok()).toBeTruthy();
  const queue = await queueResponse.json();
  const queued = queue.data?.find((row: { licenceId: string }) => row.licenceId === licenceId);
  expect(queued).toBeTruthy();
  expect(queued.isActive).toBe(false);
  expect(['pending', 'changes_requested']).toContain(queued.reviewStatus);

  const reviewResponse = await page.request.get(`/api/drivers/licences/${licenceId}/review`);
  expect(reviewResponse.ok()).toBeTruthy();
  const review = await reviewResponse.json();
  expect(review.data?.canReview).toBe(true);
  expect(review.data?.reviewable).toBe(true);
  expect(review.data?.files?.frontUrl).toBeTruthy();
  expect(review.data?.files?.backUrl).toBeTruthy();

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
  expect(updated.isActive).toBe(true);
  expect(refreshed.driver?.driverStatus).toBe('authorised');

  // Persistence check after a second fresh session: verification must not be UI-only state.
  await context.clearCookies();
  await signIn(page, 'driver');
  const persistedResponse = await page.request.get('/api/drivers/me');
  expect(persistedResponse.ok()).toBeTruthy();
  const persisted = await persistedResponse.json();
  const persistedLicence = persisted.driver?.licences?.find((licence: { id: string }) => licence.id === licenceId);
  expect(persistedLicence?.verificationStatus).toBe('verified');
  expect(persistedLicence?.isActive).toBe(true);
});
