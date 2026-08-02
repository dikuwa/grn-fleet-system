import 'server-only';

import { unstable_cache } from 'next/cache';
import { callOpenAi, isAiFeatureEnabled } from '@/lib/ai';
import type { ApprovalBriefInput } from '@/lib/approval-decision';

const cachedAiBrief = unstable_cache(
  async (
    tenantId: string,
    requestId: string,
    requestVersion: number,
    input: ApprovalBriefInput,
  ) => {
    void requestId;
    void requestVersion;
    const result = await callOpenAi({
      feature: 'request_assistant',
      tenantId,
      maxTokens: 220,
      timeoutMs: 5_000,
      system:
        'Write one concise decision brief for a government transport-request approver. Use only the supplied facts. Do not recommend an outcome, infer missing facts, or invent names, risks, compliance findings, or assignments. Explicitly say when a supplied value is Not provided or Not yet assigned. End by stating exactly what the current stage is deciding.',
      user: JSON.stringify(input),
    });
    if (!result || typeof result.json !== 'string') return null;
    const text = result.json.replace(/\s+/g, ' ').trim();
    return text.length >= 30 && text.length <= 1_200 ? text : null;
  },
  ['approval-decision-brief-v1'],
  { revalidate: 3_600 },
);

export async function generateApprovalDecisionBrief(input: {
  tenantId: string;
  requestId: string;
  requestVersion: number;
  facts: ApprovalBriefInput;
}) {
  if (!isAiFeatureEnabled('request_assistant')) return null;
  try {
    return await cachedAiBrief(input.tenantId, input.requestId, input.requestVersion, input.facts);
  } catch (error) {
    console.warn('[approval-decision-brief] Falling back to structured summary', error);
    return null;
  }
}
