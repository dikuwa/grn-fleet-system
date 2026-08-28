import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const actionPanelSource = readFileSync(
  resolve(root, 'src/components/approvals/approval-action-panel.tsx'),
  'utf8',
);
const actionRouteSource = readFileSync(
  resolve(root, 'src/app/api/approvals/[id]/action/route.ts'),
  'utf8',
);

describe('Transport Review operational note contract', () => {
  it('requires an operational handover note in the Transport Review UI before advancing', () => {
    expect(actionPanelSource).toContain("const isTransportReview = actionType === 'transport_review';");
    expect(actionPanelSource).toContain("const operationalNoteRequired = isTransportReview && selected === 'approved';");
    expect(actionPanelSource).toContain('Operational release note');
    expect(actionPanelSource).toContain('Required before Transport Review can advance.');
    expect(actionPanelSource).toContain("comment.trim().length < (operationalNoteRequired ? 3 : 1)");
  });

  it('enforces the same note requirement at the approval API boundary', () => {
    expect(actionRouteSource).toContain("stepActionType === 'transport_review'");
    expect(actionRouteSource).toContain("actionType === 'approved'");
    expect(actionRouteSource).toContain("String(comment || '').trim().length < 3");
    expect(actionRouteSource).toContain('An operational release note is required before Transport Review can advance.');
  });

  it('uses the existing workflow comment channel so the note remains in history and audit evidence', () => {
    expect(actionPanelSource).toContain('comment: comment.trim() || null');
    expect(actionRouteSource).toContain("comment: typeof comment === 'string' ? comment : undefined");
  });
});
