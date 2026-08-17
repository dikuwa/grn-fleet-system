import { describe, expect, it } from 'vitest';
import { OPERATIONAL_DELETE_STEPS } from './config';

describe('operational reset explicit child coverage', () => {
  it('counts and backs up cascade children and external operational records', () => {
    const tables = OPERATIONAL_DELETE_STEPS.map((step) => step.table);
    expect(tables).toEqual(
      expect.arrayContaining([
        'request_goods_equipment',
        'external_request_drivers',
        'external_driver_assignments',
        'notification_deliveries',
        'notification_reads',
        'notification_dismissals',
      ]),
    );
    expect(tables.indexOf('notification_deliveries')).toBeLessThan(tables.indexOf('notifications'));
    expect(tables.indexOf('request_goods_equipment')).toBeLessThan(
      tables.indexOf('transport_requests'),
    );
  });
});
