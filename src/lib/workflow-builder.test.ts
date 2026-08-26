import { describe, expect, it } from 'vitest';
import {
  normalizeAssignmentConfig,
  validateGovernedActions,
  WORKFLOW_PRESETS,
} from './workflow-builder';

describe('governed tenant workflow builder', () => {
  it('provides legacy-compatible and conditional routing presets', () => {
    expect(WORKFLOW_PRESETS.map((preset) => preset.id)).toEqual([
      'lean',
      'standard',
      'controlled',
      'internal_organisational',
      'internal_budget_controlled',
      'sponsored_external_first',
      'programme_transport',
    ]);
  });

  it('allows origin-specific governance ordering while locking the operational tail', () => {
    expect(
      validateGovernedActions([
        'finance_review',
        'organisational_approve',
        'transport_review',
        'authorise',
        'acknowledge',
      ]).ok,
    ).toBe(true);
    expect(
      validateGovernedActions([
        'organisational_approve',
        'finance_review',
        'transport_review',
        'authorise',
        'acknowledge',
      ]).ok,
    ).toBe(true);
    expect(
      validateGovernedActions([
        'transport_review',
        'finance_review',
        'authorise',
        'acknowledge',
      ]).ok,
    ).toBe(false);
  });

  it('requires the governed minimum in lifecycle order', () => {
    expect(validateGovernedActions(['transport_review', 'authorise', 'acknowledge']).ok).toBe(true);
    expect(validateGovernedActions(['authorise', 'transport_review', 'acknowledge']).ok).toBe(
      false,
    );
    expect(validateGovernedActions(['transport_review', 'authorise']).ok).toBe(false);
    expect(
      validateGovernedActions(['custom_action', 'transport_review', 'authorise', 'acknowledge']).ok,
    ).toBe(false);
  });

  it('keeps legacy named assignments and otherwise defaults to permission pools', () => {
    expect(normalizeAssignmentConfig({}, 'user-1').assignmentStrategy).toBe('named_user');
    expect(normalizeAssignmentConfig({}, null).assignmentStrategy).toBe('permission_pool');
  });
});
