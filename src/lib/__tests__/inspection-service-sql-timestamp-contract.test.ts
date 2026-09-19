import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const service = readFileSync(
  resolve(process.cwd(), 'src/lib/inspection-service.ts'),
  'utf8',
);

describe('Inspection service raw SQL timestamp contract', () => {
  it('uses a database timestamp when a critical inspection changes vehicle status', () => {
    const criticalBlock = service.slice(
      service.indexOf('if (criticalFailure) {'),
      service.indexOf("queries.push(tx.insert(maintenanceEvents)", service.indexOf('if (criticalFailure) {')),
    );

    expect(criticalBlock).toContain('updated_at = CURRENT_TIMESTAMP');
    expect(criticalBlock).not.toContain('updated_at = ${now}');
  });
});
