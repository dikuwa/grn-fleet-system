import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const corrections = readFileSync(
  'src/components/approvals/transport-request-corrections.tsx',
  'utf8',
);

describe('Transport Review correction refresh contract', () => {
  it('rebuilds draft activity state only when refreshed server props actually change', () => {
    expect(corrections).toContain("import { useEffect, useMemo, useRef, useState } from 'react'");
    expect(corrections).toContain('function buildActivityDrafts(');
    expect(corrections).toContain('const serverSnapshot = useMemo(');
    expect(corrections).toContain('const lastSyncedServerSnapshot = useRef(serverSnapshot);');
    expect(corrections).toContain('serverSnapshot === lastSyncedServerSnapshot.current || isOpen || saving');
    expect(corrections).toContain("setPurpose(initialPurpose ?? '')");
    expect(corrections).toContain("setSpecialRequirements(initialSpecialRequirements ?? '')");
    expect(corrections).toContain('setDraftActivities(buildActivityDrafts(activities))');
    expect(corrections).toContain('lastSyncedServerSnapshot.current = serverSnapshot;');
  });

  it('does not reset freshly saved local state merely because the editor closes', () => {
    expect(corrections).toContain('serverSnapshot === lastSyncedServerSnapshot.current');
    const snapshotGuardIndex = corrections.indexOf(
      'serverSnapshot === lastSyncedServerSnapshot.current || isOpen || saving',
    );
    const purposeSyncIndex = corrections.indexOf("setPurpose(initialPurpose ?? '')", snapshotGuardIndex);
    expect(snapshotGuardIndex).toBeGreaterThan(-1);
    expect(purposeSyncIndex).toBeGreaterThan(snapshotGuardIndex);
  });

  it('preserves unsaved edits while the correction editor is open', () => {
    expect(corrections).toContain('|| isOpen || saving) return;');
  });

  it('refreshes the server view after a successful governed correction', () => {
    expect(corrections).toContain('setIsOpen(false);');
    expect(corrections).toContain('router.refresh();');
    expect(corrections).toContain('This note is stored with the request revision and audit record.');
  });
});
