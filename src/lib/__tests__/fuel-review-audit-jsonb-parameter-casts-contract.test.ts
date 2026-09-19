import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const fuelRoute = readFileSync(join(process.cwd(), 'src/app/api/fuel/route.ts'), 'utf8');
const patchHandler = fuelRoute.slice(fuelRoute.indexOf('export async function PATCH'));

/** Extract each `jsonb_build_object(...)` call, including nested/multi-line arguments. */
function jsonbBuildObjectCalls(source: string): string[] {
  const calls: string[] = [];
  const marker = 'jsonb_build_object(';
  let index = source.indexOf(marker);
  while (index !== -1) {
    let depth = 0;
    let end = index;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === '(') depth++;
      else if (char === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(index, end + 1));
    index = source.indexOf(marker, index + 1);
  }
  return calls;
}

describe('Fuel review audit jsonb parameter cast contract', () => {
  it('keeps the guarded atomic review transition that the audit evidence describes', () => {
    expect(patchHandler).toContain('WITH transitioned AS (');
    expect(patchHandler).toContain('AND anomaly_state IS NOT DISTINCT FROM ${transaction.anomalyState}');
    expect(patchHandler).toContain('INSERT INTO audit_events (');
  });

  it('casts every jsonb_build_object argument so null parameters keep a determinate type', () => {
    const calls = jsonbBuildObjectCalls(patchHandler);

    expect(calls.length).toBeGreaterThanOrEqual(2);

    for (const call of calls) {
      const parameters = [...call.matchAll(/\$\{[^}]*\}(\s*::\s*[a-zA-Z_]+)?/g)];
      expect(parameters.length, `expected interpolated arguments in ${call}`).toBeGreaterThan(0);

      const uncast = parameters.filter((match) => !match[1]).map((match) => match[0]);
      // Postgres.js cannot infer a parameter type OID for a null value, so an
      // uncast null inside `jsonb_build_object(VARIADIC "any")` fails Parse with
      // 42P18 "could not determine data type of parameter $n".
      expect(uncast, `uncast jsonb_build_object argument in ${call}`).toEqual([]);
    }
  });

  it('records the reviewed before/after states with explicit boolean and text types', () => {
    expect(patchHandler).toContain(
      "jsonb_build_object('isVerified', ${transaction.isVerified}::boolean, 'anomalyState', ${transaction.anomalyState}::text)",
    );
    expect(patchHandler).toContain(
      "jsonb_build_object('isVerified', ${nextVerified}::boolean, 'anomalyState', ${nextState}::text)",
    );
  });
});
