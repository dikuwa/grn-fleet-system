import { expect, type APIRequestContext } from '@playwright/test';

const TEST_IMAGE_BYTES = Buffer.from('grn-fleet-inspection-evidence');

export async function uploadInspectionEvidence(
  api: APIRequestContext,
  label: string,
): Promise<string> {
  const response = await api.post('/api/upload', {
    multipart: {
      category: 'inspection',
      file: {
        name: `${label}-${crypto.randomUUID()}.png`,
        mimeType: 'image/png',
        buffer: TEST_IMAGE_BYTES,
      },
    },
  });

  expect(response.status(), `inspection evidence upload ${label}: ${await response.text()}`).toBe(200);
  const body = await response.json();
  expect(body?.data?.key, `inspection evidence key ${label}`).toBeTruthy();
  return body.data.key as string;
}
