import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const corrections = readFileSync(
  'src/components/approvals/transport-request-corrections.tsx',
  'utf8',
);

describe('Transport Review correction refresh contract', () => {
  it('rebuilds draft activity state from refreshed server props while the editor is closed', () => {
    expect(corrections).toContain("import { useEffect, useMemo, useState } from 'react'");
    expect(corrections).toContain('function buildActivityDrafts(');
    expect(corrections).toContain('useEffect(() => {');
    expect(corrections).toContain('if (isOpen || saving) return;');
    expect(corrections).toContain("setPurpose(initialPurpose ?? '')");
    expect(corrections).toContain("setSpecialRequirements(initialSpecialRequirements ?? '')");
    expect(corrections).toContain('setDraftActivities(buildActivityDrafts(activities))');
  });

  it('preserves unsaved edits while the correction editor is open', () => {
    const guardIndex = corrections.indexOf('if (isOpen || saving) return;');
    const purposeSyncIndex = corrections.indexOf("setPurpose(initialPurpose ?? '')", guardIndex);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(purposeSyncIndex).toBeGreaterThan(guardIndex);
  });

  it('refreshes the server view after a successful governed correction', () => {
    expect(corrections).toContain("setIsOpen(false)");
    expect(corrections).toContain('router.refresh();');
    expect(corrections).toContain('This note is stored with the request revision and audit record.');
  });
});
