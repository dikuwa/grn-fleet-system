import { expect, test } from '@playwright/test';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

async function licenceImage(input: {
  licenceNumber: string;
  side: 'FRONT' | 'BACK';
  issueDate?: string;
  expiryDate?: string;
}) {
  const svg = Buffer.from(`
    <svg width="1200" height="720" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="720" fill="white"/>
      <text x="70" y="95" font-size="48" font-family="Arial" fill="black">NAMIBIA DRIVING LICENCE</text>
      <text x="70" y="165" font-size="34" font-family="Arial" fill="black">${input.side}</text>
      <text x="70" y="255" font-size="38" font-family="Arial" fill="black">LICENCE NO ${input.licenceNumber}</text>
      <text x="70" y="335" font-size="38" font-family="Arial" fill="black">CLASS B</text>
      <text x="70" y="415" font-size="34" font-family="Arial" fill="black">ISSUED ${input.issueDate ?? '2026-01-01'}</text>
      <text x="70" y="490" font-size="34" font-family="Arial" fill="black">VALID UNTIL ${input.expiryDate ?? '2030-12-31'}</text>
      <text x="70" y="570" font-size="34" font-family="Arial" fill="black">HOLDER E2E DRIVER</text>
    </svg>
  `);
  return sharp({
    create: {
      width: 1200,
      height: 720,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: svg }])
    .png()
    .toBuffer();
}

async function signIn(page: import('@playwright/test').Page, username: string) {
  await page.goto('/login');
  await page.getByPlaceholder('Enter your username or email').fill(username);
  await page.getByPlaceholder('Enter your password').fill('changeme');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test('driver licence upload stays provisional until Transport Admin review, then persists as verified', async ({ page, context }) => {
  test.setTimeout(360_000);

  await signIn(page, 'driver');

  const meResponse = await page.request.get('/api/drivers/me');
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json();
  const employeeId = me.driver?.employeeId as string | undefined;
  expect(employeeId).toBeTruthy();

  const uniqueSuffix = Date.now().toString();
  const uploadedNumber = `E2E-${uniqueSuffix.slice(-8)}`;
  const correctedNumber = `${uploadedNumber}-OK`;
  const [frontImage, backImage] = await Promise.all([
    licenceImage({ licenceNumber: uploadedNumber, side: 'FRONT' }),
    licenceImage({ licenceNumber: uploadedNumber, side: 'BACK' }),
  ]);

  const uploadStartedAt = Date.now();
  const uploadResponse = await page.request.post(`/api/drivers/${employeeId}/licences`, {
    multipart: {
      front: {
        name: `licence-front-${uniqueSuffix}.png`,
        mimeType: 'image/png',
        buffer: frontImage,
      },
      back: {
        name: `licence-back-${uniqueSuffix}.png`,
        mimeType: 'image/png',
        buffer: backImage,
      },
      licenceNumber: uploadedNumber,
      licenceClass: 'B',
      issueDate: '2026-01-01',
      expiryDate: '2030-12-31',
    },
    timeout: 180_000,
  });

  expect(Date.now() - uploadStartedAt, 'OCR/upload request must complete within three minutes').toBeLessThan(180_000);
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

  await context.clearCookies();
  await signIn(page, 'driver');
  const persistedResponse = await page.request.get('/api/drivers/me');
  expect(persistedResponse.ok()).toBeTruthy();
  const persisted = await persistedResponse.json();
  const persistedLicence = persisted.driver?.licences?.find((licence: { id: string }) => licence.id === licenceId);
  expect(persistedLicence?.verificationStatus).toBe('verified');
  expect(persistedLicence?.isActive).toBe(true);
});
