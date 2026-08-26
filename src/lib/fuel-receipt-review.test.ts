import { describe, expect, it } from 'vitest';
import {
  isTerminalReceiptReviewStatus,
  normaliseReceiptCorrections,
} from './fuel-receipt-review';

describe('fuel receipt review lifecycle', () => {
  it.each(['verified', 'rejected'])('treats %s as terminal', (status) => {
    expect(isTerminalReceiptReviewStatus(status)).toBe(true);
  });

  it.each(['awaiting_verification', 'ocr_confirmed', 'manually_corrected', 'ocr_failed'])(
    'allows review preparation while status is %s',
    (status) => {
      expect(isTerminalReceiptReviewStatus(status)).toBe(false);
    },
  );

  it('preserves intentional clears as null corrections', () => {
    const result = normaliseReceiptCorrections(
      { supplier: '  ', amount: null, litres: 12.5 },
      new Set(['supplier', 'amount', 'litres']),
    );
    expect(result).toEqual({
      ok: true,
      entries: [
        ['supplier', null],
        ['amount', null],
        ['litres', 12.5],
      ],
    });
  });

  it('rejects unsupported fields and value types', () => {
    expect(normaliseReceiptCorrections({ secret: 'x' }, new Set(['supplier']))).toEqual({
      ok: false,
    });
    expect(normaliseReceiptCorrections({ supplier: { value: 'x' } }, new Set(['supplier']))).toEqual(
      { ok: false },
    );
  });
});
