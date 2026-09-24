// raceTest.js
// Fires genuinely simultaneous requests (via Promise.all) at the 4
// concurrency gates, since Postman can only send requests one at a time
// and can never actually prove a race condition either way.
//
// Run with: node raceTest.js   (from your backend project folder)
// Requires Node 18+ (uses the built-in fetch — no extra install needed).

const BASE_URL = "http://localhost:1234/api";

// EDIT THESE two lines to match your real admin account before running.
const ADMIN_IDENTIFIER = "9876512345";
const ADMIN_PASSWORD = "Admin100";

const RUN_ID = Date.now().toString().slice(-8);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const post = async (path, body, token) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const login = async (identifier, password) => {
  const { ok, data } = await post("/users/login", { identifier, password });
  if (!ok) throw new Error(`Login failed for ${identifier}: ${JSON.stringify(data)}`);
  return data.data.accessToken;
};

// Builds a valid, unique 10-digit phone number per test-user index, so
// Joi's phone validation (/^[0-9]{10}$/) always passes and never collides.
const phoneFor = (idx) => `9${RUN_ID}${idx}`.slice(0, 10).padEnd(10, "0");

const createUser = async (adminToken, idx) => {
  const email = `racetest_${RUN_ID}_${idx}@example.com`;
  const { ok, data } = await post(
    "/users",
    {
      name: `Race Test User ${idx}`,
      email,
      phone: phoneFor(idx),
      password: "Test@1234",
      role: "customer",
    },
    adminToken
  );
  if (!ok) throw new Error(`Create user failed (${email}): ${JSON.stringify(data)}`);
  const userToken = await login(email, "Test@1234");
  return { id: data.data._id, email, token: userToken };
};

const createCoupon = async (adminToken, { suffix, maxUses, perUserLimit, discountValue = 10 }) => {
  const code = `RACE_${suffix}_${RUN_ID}`;
  const { ok, data } = await post(
    "/admin/coupons",
    {
      code,
      discountType: "PERCENT",
      discountValue,
      maxUses,
      perUserLimit,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    adminToken
  );
  if (!ok) throw new Error(`Create coupon failed (${code}): ${JSON.stringify(data)}`);
  return code;
};

const redeem = async (userToken, code, orderId, orderAmount = 1000) =>
  post("/redemptions/redeem", { code, orderId, orderAmount }, userToken);

// Prints a clean PASS/FAIL summary for a batch of parallel redeem attempts.
const summarize = (label, results, expectedSucceeded) => {
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const pass = expectedSucceeded === undefined || succeeded === expectedSucceeded;
  console.log(
    `${label}: Succeeded: ${succeeded} | Failed: ${failed}${
      expectedSucceeded !== undefined ? ` | Expected: ${expectedSucceeded}` : ""
    } — ${pass ? "PASS" : "FAIL"}`
  );
  return { succeeded, failed, results };
};

// ---------------------------------------------------------------------------
// GATE 1 — total maxUses, enforced across MANY DIFFERENT users at once.
// 5 different users hit a coupon capped at 3 total uses, simultaneously.

const testGate1MaxUses = async (adminToken) => {
  const code = await createCoupon(adminToken, { suffix: "G1", maxUses: 3, perUserLimit: 10 });
  const users = await Promise.all([0, 1, 2, 3, 4].map((i) => createUser(adminToken, `g1_${i}`)));

  const results = await Promise.all(
    users.map((u, i) => redeem(u.token, code, `g1_order_${RUN_ID}_${i}`))
  );

  summarize("GATE 1 (maxUses=3, 5 different users)", results, 3);
};

// ---------------------------------------------------------------------------
// GATE 2 — per-user limit, ONE user firing many parallel attempts.


const testGate2PerUserLimit1 = async (adminToken) => {
  const code = await createCoupon(adminToken, { suffix: "G2A", maxUses: 100, perUserLimit: 1 });
  const user = await createUser(adminToken, "g2a");

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => redeem(user.token, code, `g2a_order_${RUN_ID}_${i}`))
  );

  summarize("GATE 2 (perUserLimit=1, 10 parallel from one user)", results, 1);
};

// ---------------------------------------------------------------------------
// GATE 2b — same idea, but perUserLimit=2
const testGate2PerUserLimit2 = async (adminToken) => {
  const code = await createCoupon(adminToken, { suffix: "G2B", maxUses: 100, perUserLimit: 2 });
  const user = await createUser(adminToken, "g2b");

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => redeem(user.token, code, `g2b_order_${RUN_ID}_${i}`))
  );

  summarize("GATE 2b (perUserLimit=2, 5 parallel from one user)", results, 2);
};

// ---------------------------------------------------------------------------
// GATE 3 — idempotency. 
const testGate3Idempotency = async (adminToken) => {
  const code = await createCoupon(adminToken, { suffix: "G3", maxUses: 100, perUserLimit: 100 });
  const user = await createUser(adminToken, "g3");
  const orderId = `g3_order_${RUN_ID}`;

  const results = await Promise.all(
    Array.from({ length: 10 }, () => redeem(user.token, code, orderId))
  );

  const succeeded = results.filter((r) => r.ok);
  const distinctIds = new Set(succeeded.map((r) => r.data?.data?._id));

  console.log(
    `GATE 3 (idempotency, same orderId x10 parallel): Succeeded: ${succeeded.length} | ` +
      `Failed: ${results.length - succeeded.length} | Distinct redemption IDs: ${distinctIds.size} — ` +
      `${succeeded.length === 10 && distinctIds.size === 1 ? "PASS" : "FAIL"}`
  );
};

// ---------------------------------------------------------------------------
// GATE 3b 
const testGate3RetryAfterExhausted = async (adminToken) => {
  const code = await createCoupon(adminToken, { suffix: "G3B", maxUses: 100, perUserLimit: 1 });
  const user = await createUser(adminToken, "g3b");
  const orderId = `g3b_order_${RUN_ID}`;

  const first = await redeem(user.token, code, orderId);
  if (!first.ok) throw new Error(`Setup redemption failed: ${JSON.stringify(first.data)}`);

  const retries = await Promise.all(
    Array.from({ length: 10 }, () => redeem(user.token, code, orderId))
  );

  const succeeded = retries.filter((r) => r.ok);
  const distinctIds = new Set([first, ...succeeded].map((r) => r.data?.data?._id));

  console.log(
    `GATE 3b (retry after limit exhausted): Retries succeeded: ${succeeded.length} | ` +
      `Failed: ${retries.length - succeeded.length} | Distinct redemption IDs: ${distinctIds.size} — ` +
      `${succeeded.length === 10 && distinctIds.size === 1 ? "PASS" : "FAIL"}`
  );
};

const main = async () => {
  console.log(`\nRace test run ${RUN_ID} — logging in as admin...\n`);
  const adminToken = await login(ADMIN_IDENTIFIER, ADMIN_PASSWORD);

  await testGate1MaxUses(adminToken);
  await testGate2PerUserLimit1(adminToken);
  await testGate2PerUserLimit2(adminToken);
  await testGate3Idempotency(adminToken);
  await testGate3RetryAfterExhausted(adminToken);

  console.log("\nAll gate tests complete.\n");
};

main().catch((err) => {
  console.error("\nRace test run failed:", err.message);
  process.exit(1);
});