import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

test.describe.serial('Public request lifecycle', () => {
  test.setTimeout(60_000);

  test('1. Employee without a login account can submit a verified request', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE });

    // --- OTP request ---
    const otpResponse = await ctx.post(`/api/public/requests/kavango-east/otp`, {
      data: { employeeNumber: 'KERC002', verifier: 'Shikongo' },
    });
    expect(otpResponse.status(), await otpResponse.text()).toBe(200);
    const otpBody = await otpResponse.json();

    // In dev mode without Resend, the OTP is returned inline
    const otp = otpBody.developmentOtp;
    test.skip(!otp, 'Skipping verified-submit test: email sending succeeded (no dev OTP), or rate-limited');
    expect(otpBody.verificationId).toBeTruthy();
    expect(otpBody.destination).toMatch(/^.+@kavangoeast\.test$/);
    const verificationId = otpBody.verificationId;

    // --- OTP verify ---
    const verifyResponse = await ctx.post(`/api/public/requests/kavango-east/verify`, {
      data: { verificationId, otp },
    });
    expect(verifyResponse.status(), await verifyResponse.text()).toBe(200);
    const verifyBody = await verifyResponse.json();
    expect(verifyBody.employee).toBeTruthy();
    expect(verifyBody.employee.firstName).toBeTruthy();
    // Cookie is now auto-stored in the APIRequestContext

    // --- Submit request (secure session cookie auto-attached) ---
    const submitResponse = await ctx.post(`/api/public/requests/kavango-east/submit`, {
      data: {
        purpose: 'Official duty travel — E2E test',
        origin: 'Rundu',
        destination: 'Windhoek',
        departureDate: new Date(Date.now() + 7 * 86_400_000).toISOString().split('T')[0],
        departureTime: '08:00',
        returnDate: new Date(Date.now() + 10 * 86_400_000).toISOString().split('T')[0],
        returnTime: '17:00',
        tripType: 'regional',
        passengers: JSON.stringify([{ name: 'Test Passenger', organisation: 'Kavango East' }]),
        emergency: 'false',
      },
    });
    const submitBody = await submitResponse.json();
    expect(submitResponse.status(), JSON.stringify(submitBody)).toBe(200);
    expect(submitBody.reference).toMatch(/^REQ-/);
    expect(submitBody.id).toBeTruthy();

    // Store reference for idempotency check
    const requestReference = submitBody.reference;
    const requestId = submitBody.id;

    // --- Idempotency: verify duplicate submit returns the same reference ---
    const duplicateResponse = await ctx.post(`/api/public/requests/kavango-east/submit`, {
      data: {
        purpose: 'Official duty travel — E2E test',
        origin: 'Rundu',
        destination: 'Windhoek',
        departureDate: new Date(Date.now() + 7 * 86_400_000).toISOString().split('T')[0],
        departureTime: '08:00',
        returnDate: new Date(Date.now() + 10 * 86_400_000).toISOString().split('T')[0],
        returnTime: '17:00',
        tripType: 'regional',
        passengers: JSON.stringify([{ name: 'Test Passenger', organisation: 'Kavango East' }]),
        emergency: 'false',
      },
    });
    const duplicateBody = await duplicateResponse.json();
    expect(duplicateResponse.status(), JSON.stringify(duplicateBody)).toBe(200);
    expect(duplicateBody.reference).toBe(requestReference);
    expect(duplicateBody.id).toBe(requestId);

    // --- Track the request ---
    const trackResponse = await ctx.get(`/api/public/requests/kavango-east/track/${requestId}`);
    expect(trackResponse.status(), await trackResponse.text()).toBe(200);
    const trackBody = await trackResponse.json();
    expect(trackBody.reference).toBe(requestReference);
    expect(trackBody.status).toBeTruthy();

    await ctx.dispose();
  });

  test('2. Invalid credentials are gracefully rejected', async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE });
    const uniqueVerifier = `nobody-${Date.now()}`;

    // Non-existent employee number + verifier should get generic message
    const otpResponse = await ctx.post(`/api/public/requests/kavango-east/otp`, {
      data: { employeeNumber: 'DOES-NOT-EXIST', verifier: uniqueVerifier },
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

    // Establish a valid secure session
    const otpResponse = await ctx.post(`/api/public/requests/kavango-east/otp`, {
      data: { employeeNumber: 'KERC002', verifier: 'Shikongo' },
    });
    if (otpResponse.status() === 429) {
      test.skip(true, 'Rate-limited on OTP for test 3 — too many runs in 15 min window');
      return;
    }
    expect(otpResponse.status(), await otpResponse.text()).toBe(200);
    const otpBody = await otpResponse.json();
    const otp = otpBody.developmentOtp;
    test.skip(!otp, 'No development OTP available — email sent successfully (Resend configured)');
    const verificationId = otpBody.verificationId;

    // Verify OTP
    const verifyResponse = await ctx.post(`/api/public/requests/kavango-east/verify`, {
      data: { verificationId, otp },
    });
    expect(verifyResponse.status(), await verifyResponse.text()).toBe(200);

    // Submit with empty/missing required fields
    const submitResponse = await ctx.post(`/api/public/requests/kavango-east/submit`, {
      data: {
        purpose: '',
        origin: '',
        destination: '',
        departureDate: '',
        departureTime: '',
        returnDate: '',
        returnTime: '',
        tripType: '',
        passengers: '',
        emergency: '',
      },
    });
    expect(submitResponse.status()).toBe(400);
    const submitBody = await submitResponse.json();
    expect(submitBody.error).toMatch(/required/i);

    await ctx.dispose();
  });
});
