const BASE_URL = "http://localhost:1234/api"; // change the port if yours differs

async function login(identifier, password) {
  const res = await fetch(`${BASE_URL}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(`Login failed for ${identifier}: ${JSON.stringify(json)}`);
  return json.data.accessToken;
}

async function createUser(adminToken, user) {
  const res = await fetch(`${BASE_URL}/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(user),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(
      `Could not create ${user.email}: ${JSON.stringify(json.errors || json.message)}`,
    );
  }
}

async function createCoupon(adminToken, coupon) {
  const res = await fetch(`${BASE_URL}/admin/coupons`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(coupon),
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      `Could not create coupon ${coupon.code}: ${JSON.stringify(json.errors || json.message)}`,
    );
  return json.data;
}

async function redeem(token, code, orderId, orderAmount) {
  const res = await fetch(`${BASE_URL}/redemptions/redeem`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code, orderId, orderAmount }),
  });
  const json = await res.json();
  return {
    status: res.status,
    success: res.ok,
    redemptionId: json.data?._id,
    message: json.message || json.errors?.[0]?.message,
  };
}

// ---------------------------------------------------------------------------
// GATE 1: max total uses, across DIFFERENT users. Creates 5 fresh customer
// accounts and a fresh coupon with maxUses=3, fires all 5 redemptions
// concurrently. Expected: exactly 3 succeed.
// ---------------------------------------------------------------------------
async function testGate1MaxUses(adminToken) {
  console.log(
    "\n=== GATE 1: Max total uses — 5 different users firing concurrently at a coupon with maxUses=3 ===",
  );

  const runId = Date.now();
  const couponCode = `RACE1-${runId}`;
  await createCoupon(adminToken, {
    code: couponCode,
    discountType: "PERCENT",
    discountValue: 10,
    maxUses: 3,
    perUserLimit: 1,
    expiresAt: "2026-12-31T23:59:59.000Z",
  });

  const users = Array.from({ length: 5 }, (_, i) => ({
    name: `Race User ${i}`,
    email: `raceuser${runId}${i}@example.com`,
    phone: `9${String(runId).slice(-8)}${i}`,
    password: "RaceUser@123",
    role: "customer",
  }));

  for (const u of users) await createUser(adminToken, u);
  const tokens = await Promise.all(
    users.map((u) => login(u.phone, u.password)),
  );

  const results = await Promise.all(
    tokens.map((token, i) =>
      redeem(token, couponCode, `${couponCode}-order-${i}`, 100),
    ),
  );

  const succeeded = results.filter((r) => r.success).length;
  console.log(
    `Succeeded: ${succeeded} | Failed: ${results.length - succeeded}`,
  );
  results.forEach((r, i) =>
    console.log(
      `  user#${i}: ${r.status} - ${r.success ? "OK id=" + r.redemptionId : r.message}`,
    ),
  );
  console.log(
    succeeded === 3
      ? "PASS — exactly maxUses (3) succeeded across different users"
      : `CHECK — expected 3, got ${succeeded}`,
  );
}

// ---------------------------------------------------------------------------
// GATE 2: per-user limit at perUserLimit=1. One fresh user, one fresh
// coupon, 10 concurrent redemption attempts. Expected: exactly 1 succeeds.
// ---------------------------------------------------------------------------
async function testGate2PerUserLimit(adminToken) {
  console.log(
    "\n=== GATE 2: Per-user limit (perUserLimit=1) — one user firing 10 concurrent redemptions ===",
  );

  const runId = Date.now();
  const couponCode = `RACE2-${runId}`;
  await createCoupon(adminToken, {
    code: couponCode,
    discountType: "PERCENT",
    discountValue: 10,
    maxUses: 100,
    perUserLimit: 1,
    expiresAt: "2026-12-31T23:59:59.000Z",
  });

  const user = {
    name: "Race Gate2 User",
    email: `raceg2_${runId}@example.com`,
    phone: `9${String(runId).slice(-9)}`,
    password: "RaceUser@123",
    role: "customer",
  };
  await createUser(adminToken, user);
  const token = await login(user.phone, user.password);

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      redeem(token, couponCode, `${couponCode}-order-${i}`, 100),
    ),
  );

  const succeeded = results.filter((r) => r.success).length;
  console.log(`Succeeded: ${succeeded} | Failed: ${10 - succeeded}`);
  results.forEach((r, i) =>
    console.log(
      `  #${i}: ${r.status} - ${r.success ? "OK id=" + r.redemptionId : r.message}`,
    ),
  );
  console.log(
    succeeded === 1
      ? "PASS — exactly 1 succeeded"
      : `MISMATCH — expected 1, got ${succeeded}`,
  );
}

// ---------------------------------------------------------------------------
// GATE 2 (retest): perUserLimit=2 - proves the fixed counter-based approach
// respects the coupon's ACTUAL configured limit, not a hardcoded 1. One
// user, 5 concurrent attempts against perUserLimit=2. Expected: exactly 2
// succeed, 3 rejected.
// ---------------------------------------------------------------------------
async function testGate2PerUserLimitOf2(adminToken) {
  console.log(
    "\n=== GATE 2 (retest): perUserLimit=2 — same user firing 5 concurrent redemptions ===",
  );

  const runId = Date.now();
  const couponCode = `RACE2B-${runId}`;
  await createCoupon(adminToken, {
    code: couponCode,
    discountType: "PERCENT",
    discountValue: 10,
    maxUses: 100,
    perUserLimit: 2,
    expiresAt: "2026-12-31T23:59:59.000Z",
  });

  const user = {
    name: "Race Gate2b User",
    email: `raceg2b_${runId}@example.com`,
    phone: `7${String(runId).slice(-9)}`,
    password: "RaceUser@123",
    role: "customer",
  };
  await createUser(adminToken, user);
  const token = await login(user.phone, user.password);

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      redeem(token, couponCode, `${couponCode}-order-${i}`, 100),
    ),
  );

  const succeeded = results.filter((r) => r.success).length;
  console.log(`Succeeded: ${succeeded} | Failed: ${5 - succeeded}`);
  results.forEach((r, i) =>
    console.log(
      `  #${i}: ${r.status} - ${r.success ? "OK id=" + r.redemptionId : r.message}`,
    ),
  );
  console.log(
    succeeded === 2
      ? "PASS — exactly perUserLimit (2) succeeded"
      : `MISMATCH — expected 2, got ${succeeded}`,
  );
}

// ---------------------------------------------------------------------------
// GATE 3: idempotency. One fresh user, one fresh coupon, SAME orderId fired
// 10 times concurrently. Every one of these is EXPECTED to come back
// "successful" (1 real create + 9 idempotent returns) — what actually
// proves idempotency is whether all 10 responses carry the SAME redemption
// _id.
// ---------------------------------------------------------------------------
async function testGate3Idempotency(adminToken) {
  console.log(
    "\n=== GATE 3: Idempotency — same orderId fired 10 times concurrently ===",
  );

  const runId = Date.now();
  const couponCode = `RACE3-${runId}`;
  await createCoupon(adminToken, {
    code: couponCode,
    discountType: "PERCENT",
    discountValue: 10,
    maxUses: 100,
    perUserLimit: 1,
    expiresAt: "2026-12-31T23:59:59.000Z",
  });

  const user = {
    name: "Race Gate3 User",
    email: `raceg3_${runId}@example.com`,
    phone: `8${String(runId).slice(-9)}`,
    password: "RaceUser@123",
    role: "customer",
  };
  await createUser(adminToken, user);
  const token = await login(user.phone, user.password);

  const sameOrderId = `${couponCode}-dup-order`;
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      redeem(token, couponCode, sameOrderId, 100),
    ),
  );

  const succeeded = results.filter((r) => r.success).length;
  const distinctIds = new Set(
    results.filter((r) => r.success).map((r) => r.redemptionId),
  );
  console.log(
    `Succeeded: ${succeeded} | Failed: ${10 - succeeded} | Distinct redemption IDs: ${distinctIds.size}`,
  );
  results.forEach((r, i) =>
    console.log(
      `  #${i}: ${r.status} - ${r.success ? "OK id=" + r.redemptionId : r.message}`,
    ),
  );
  console.log(
    distinctIds.size === 1
      ? "PASS — all successful responses point to the SAME redemption record (true idempotency)"
      : `FAIL — ${distinctIds.size} distinct redemption records created for the same orderId (idempotency broken)`,
  );
}

// ---------------------------------------------------------------------------
// GATE 3 (retry-after-limit-exhausted): the scenario the previous test
// couldn't catch. A user redeems once (using their only slot under
// perUserLimit=1), THEN retries the SAME orderId again — 10 times,
// concurrently, well after the original succeeded. A correct system
// recognizes these as retries of an already-completed order and returns
// the SAME record every time — NOT "Per-user redemption limit reached".
// ---------------------------------------------------------------------------
async function testGate3RetryAfterLimitExhausted(adminToken) {
  console.log(
    "\n=== GATE 3 (retry-after-exhausted): same orderId retried 10x AFTER the user's one slot is already used ===",
  );

  const runId = Date.now();
  const couponCode = `RACE3B-${runId}`;
  await createCoupon(adminToken, {
    code: couponCode,
    discountType: "PERCENT",
    discountValue: 10,
    maxUses: 100,
    perUserLimit: 1,
    expiresAt: "2026-12-31T23:59:59.000Z",
  });

  const user = {
    name: "Race Gate3b User",
    email: `raceg3b_${runId}@example.com`,
    phone: `6${String(runId).slice(-9)}`,
    password: "RaceUser@123",
    role: "customer",
  };
  await createUser(adminToken, user);
  const token = await login(user.phone, user.password);

  const orderId = `${couponCode}-order-original`;

  // First, redeem successfully and let it fully complete — this consumes
  // the user's one and only slot under perUserLimit=1.
  const first = await redeem(token, couponCode, orderId, 100);
  console.log(
    `  Initial redemption: ${first.status} - ${first.success ? "OK id=" + first.redemptionId : first.message}`,
  );
  if (!first.success) {
    console.log(
      "  Could not even complete the initial redemption — aborting this test.",
    );
    return;
  }

  // NOW fire 10 concurrent retries of the SAME orderId, after the slot is
  // already used up. Every one of these should come back successful,
  // pointing at the SAME redemption id as the original.
  const retries = await Promise.all(
    Array.from({ length: 10 }, () => redeem(token, couponCode, orderId, 100)),
  );

  const succeeded = retries.filter((r) => r.success).length;
  const distinctIds = new Set(
    retries.filter((r) => r.success).map((r) => r.redemptionId),
  );
  const allMatchOriginal = [...distinctIds].every(
    (id) => id === first.redemptionId,
  );

  console.log(
    `Retries succeeded: ${succeeded} | Failed: ${10 - succeeded} | Distinct IDs among successes: ${distinctIds.size}`,
  );
  retries.forEach((r, i) =>
    console.log(
      `  retry#${i}: ${r.status} - ${r.success ? "OK id=" + r.redemptionId : r.message}`,
    ),
  );

  if (succeeded === 10 && distinctIds.size === 1 && allMatchOriginal) {
    console.log(
      "PASS — all 10 retries correctly recognized as the same original order, no false rejections",
    );
  } else {
    console.log(
      `FAIL — expected all 10 retries to succeed and match the original id (${first.redemptionId}), got ${succeeded} successes with ${distinctIds.size} distinct id(s)`,
    );
  }
}

(async () => {
  try {
    const adminToken = await login("9876512345", "Admin100");

    await testGate1MaxUses(adminToken);
    await testGate2PerUserLimit(adminToken);
    await testGate2PerUserLimitOf2(adminToken);
    await testGate3Idempotency(adminToken);
    await testGate3RetryAfterLimitExhausted(adminToken);
  } catch (err) {
    console.error("Test script error:", err.message);
  }
})();
