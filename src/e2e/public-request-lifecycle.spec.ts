import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

test.describe.serial('Public request lifecycle', () => {
  test.setTimeout(60_000);

  test('1. Employee without a login account can submit a verified request', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE });

    // --- Directory verification ---
    // Disposable CI intentionally has no email provider configured. The
    // secure intake therefore verifies against the active staff directory and
    // establishes the HttpOnly secure-request session without exposing an OTP.
    const verifyResponse = await ctx.post(`/api/public/requests/kavango-east/otp`, {
      data: {
        employeeNumber: 'KERC002',
        surname: 'Shikongo',
        verifier: 'requester@kavangoeast.test',
      },
    });
    expect(verifyResponse.status(), await verifyResponse.text()).toBe(200);
    const verifyBody = await verifyResponse.json();
    expect(verifyBody.mode).toBe('directory');
    expect(verifyBody.employee).toMatchObject({
      firstName: 'Maria',
      lastName: 'Shikongo',
      employeeNumber: 'KERC002',
    });
    // The secure session cookie is auto-stored in this APIRequestContext.

    // --- Submit request (secure session cookie auto-attached) ---
    const departureAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const returnAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const clientSubmissionId = crypto.randomUUID();
    const requestPayload = {
      purpose: 'Official duty travel — E2E test',
      origin: 'Rundu',
      destination: 'Windhoek',
      departureAt,
      returnAt,
      scope: 'regional' as const,
      passengers: [{ externalName: 'Test Passenger' }],
      clientSubmissionId,
    };

    const submitResponse = await ctx.post(`/api/public/requests/kavango-east/submit`, {
      data: requestPayload,
    });
    const submitBody = await submitResponse.json();
    expect(submitResponse.status(), JSON.stringify(submitBody)).toBe(201);
    expect(submitBody.request.reference).toMatch(/^GRN\/TR\//);
    expect(submitBody.request.id).toBeTruthy();
    expect(submitBody.trackingUrl).toBeTruthy();

    const requestReference = submitBody.request.reference as string;
    const requestId = submitBody.request.id as string;

    // --- Idempotency: duplicate submit with the same clientSubmissionId returns the same request ---
    const duplicateResponse = await ctx.post(`/api/public/requests/kavango-east/submit`, {
      data: requestPayload,
    });
    const duplicateBody = await duplicateResponse.json();
    expect(duplicateResponse.status(), JSON.stringify(duplicateBody)).toBe(200);
    expect(duplicateBody.duplicate).toBe(true);
    expect(duplicateBody.request.reference).toBe(requestReference);
    expect(duplicateBody.request.id).toBe(requestId);

    // --- Track the request with the signed tracking token returned by submit ---
    const trackingUrl = new URL(submitBody.trackingUrl as string);
    const trackResponse = await ctx.get(
      `${trackingUrl.pathname}${trackingUrl.search}`,
    );
    expect(trackResponse.status(), await trackResponse.text()).toBe(200);
    const trackBody = await trackResponse.json();
    expect(trackBody.request.reference).toBe(requestReference);
    expect(trackBody.request.status).toBeTruthy();

    await ctx.dispose();
  });

  test('2. Invalid credentials are gracefully rejected', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE });
    const uniqueVerifier = `nobody-${Date.now()}`;

    // Non-existent employee number + verifier should get generic message
    const otpResponse = await ctx.post(`/api/public/requests/kavango-east/otp`, {
      data: {
        employeeNumber: 'DOES-NOT-EXIST',
        surname: 'Nobody',
        verifier: uniqueVerifier,
      },
    });
    expect(otpResponse.status(), await otpResponse.text()).toBe(200);
    const body = await otpResponse.json();
    expect(body.message).toMatch(/could not verify|active employee record/i);
    // No verificationId should be returned for unmatched employees
    expect(body.verificationId).toBeUndefined();

    await ctx.dispose();
  });

  test('3. Missing required submit fields return 400', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE });

    // Establish a separate valid directory-backed secure session so this
    // validation test does not share identity-rate-limit state with test 1.
    const verifyResponse = await ctx.post(`/api/public/requests/kavango-east/otp`, {
      data: {
        employeeNumber: 'KERC003',
        surname: 'Ndara',
        verifier: 'supervisor@kavangoeast.test',
      },
    });
    expect(verifyResponse.status(), await verifyResponse.text()).toBe(200);
    const verifyBody = await verifyResponse.json();
    expect(verifyBody.mode).toBe('directory');

    // Submit with empty/missing required fields
    const submitResponse = await ctx.post(`/api/public/requests/kavango-east/submit`, {
      data: {
        purpose: '',
        origin: '',
        destination: '',
        departureAt: '',
        returnAt: '',
        scope: 'regional',
        passengers: [],
      },
    });
    expect(submitResponse.status()).toBe(400);
    const submitBody = await submitResponse.json();
    expect(submitBody.error).toMatch(/required/i);

    await ctx.dispose();
  });
});
