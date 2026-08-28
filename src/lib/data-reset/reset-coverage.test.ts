import { describe, expect, it } from 'vitest';
import { OPERATIONAL_DELETE_STEPS } from './config';

describe('operational reset explicit child coverage', () => {
  it('counts and backs up cascade children and external operational records', () => {
    const tables = OPERATIONAL_DELETE_STEPS.map((step) => step.table);
    expect(tables).toEqual(
      expect.arrayContaining([
        'request_goods_equipment',
        'share_access_events',
        'external_request_drivers',
        'external_driver_assignments',
        'notification_deliveries',
        'notification_reads',
        'notification_dismissals',
      ]),
    );
    expect(tables.indexOf('notification_deliveries')).toBeLessThan(tables.indexOf('notifications'));
    expect(tables.indexOf('share_access_events')).toBeLessThan(tables.indexOf('share_links'));
    expect(tables.indexOf('request_goods_equipment')).toBeLessThan(
      tables.indexOf('transport_requests'),
    );
  });

  it('collects storage keys for every file-bearing operational row deleted by reset', () => {
    const storageColumns = Object.fromEntries(
      OPERATIONAL_DELETE_STEPS
        .filter((step) => step.fileKeyColumns?.length)
        .map((step) => [step.table, step.fileKeyColumns]),
    );

    expect(storageColumns).toMatchObject({
      generated_documents: ['file_key'],
      request_attachments: ['file_key'],
      trip_authority_passengers: ['indemnity_document_key'],
      trip_progress_entries: ['attachment_key'],
      trip_expenses: ['receipt_key'],
      trip_incidents: ['attachment_keys'],
      fuel_receipts: ['file_key'],
      inspection_photos: ['file_key'],
    });
  });
});
