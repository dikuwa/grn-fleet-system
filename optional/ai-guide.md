# AI and Recommendation Guide

## Principle

AI assists; it does not approve, release, authorise, calculate the official mapped distance or make an irreversible fleet decision.

## Vehicle recommendation

The primary engine is deterministic and explainable.

Inputs:

- trip scope;
- route and road information;
- terrain selected by requester/administrator;
- passenger count;
- luggage/equipment;
- accessibility need;
- trip duration;
- available eligible vehicles;
- fuel-efficiency preference.

Output:

- ranked vehicle categories;
- rule-based reasons;
- disqualifications;
- confidence/quality based on data completeness.

The Transport Administrator chooses the exact vehicle. Any override records a reason.

## Optional language-model use

Behind a feature flag, a model may:

- convert rule output into a concise explanation;
- suggest clarification when terrain/destination description is ambiguous;
- classify free-text activity into reporting categories;
- propose anomalies for human review.

It must not receive full IDs, licence numbers, private signatures or unnecessary personal data.

## Route distance

Google Routes API returns the official system estimate. Store distance, duration, route polyline, place IDs and calculation time. Additional kilometres are manual and separately auditable.

## Fuel receipt extraction

Receipt extraction is optional and never the only entry path. If enabled:

1. User uploads a receipt.
2. Extraction proposes station, date, product, litres, amount, odometer and reference.
3. User verifies every value.
4. Original image remains linked.
5. Confidence and corrections are stored.

Do not auto-approve reimbursement from extracted data.

## Model provider abstraction

Use a typed adapter with disabled-by-default configuration. The core app must work without any LLM key. Record provider, model, prompt version and safe output for audit when AI is used.

## Safety and quality

- no automatic approval/action execution;
- structured JSON output validated by Zod;
- timeout and fallback;
- no training on tenant data without explicit agreement;
- prompt injection is irrelevant to official decision paths because model output remains advisory;
- monitor recommendation override rates before expanding AI scope.
