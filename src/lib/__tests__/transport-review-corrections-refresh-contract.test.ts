import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const actionPage = readFileSync(
  'src/app/(dashboard)/dashboard/approvals/[id]/action/page.tsx',
  'utf8',
);
const corrections = readFileSync(
  'src/components/approvals/transport-request-corrections.tsx',
  'utf8',
);

describe('Transport Review correction refresh contract', () => {
  it('keys the correction editor to the governed request revision', () => {
    expect(actionPage).toContain('<TransportRequestCorrections');
    expect(actionPage).toContain('key={`${detail.instance.requestId}:${detail.instance.revision}`}');
    expect(actionPage).toContain('requestId={detail.instance.requestId}');
  });

  it('refreshes the server view after a successful governed correction', () => {
    expect(corrections).toContain('setIsOpen(false);');
    expect(corrections).toContain('router.refresh();');
    expect(corrections).toContain('This note is stored with the request revision and audit record.');
  });

  it('keeps local editor state simple and avoids effect-driven prop synchronization', () => {
    expect(corrections).toContain("import { useMemo, useState } from 'react'");
    expect(corrections).not.toContain('useEffect(');
    expect(corrections).not.toContain('serverSnapshot');
  });
});
