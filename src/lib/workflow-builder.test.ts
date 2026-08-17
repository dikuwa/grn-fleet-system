import { describe, expect, it } from 'vitest';
import {
  normalizeAssignmentConfig,
  validateGovernedActions,
  WORKFLOW_PRESETS,
} from './workflow-builder';

describe('governed tenant workflow builder', () => {
  it('provides the three approved presets', () => {
    expect(WORKFLOW_PRESETS.map((preset) => preset.id)).toEqual(['lean', 'standard', 'controlled']);
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
