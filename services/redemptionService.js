import mongoose from "mongoose";
import Coupon, { COUPON_STATUS } from "../models/couponModel.js";
import { APIFeatures } from "../utils/apiFeatures.js";
import Redemption, { REDEMPTION_STATUS } from "../models/redemptionModel.js";
import AppError from "../middlewares/appError.js";
import { calculateDiscount } from "../utils/helpers.js";
import UserCouponUsage from "../models/userCouponUsageModel.js";


// Distinguishes "the Redemption insert hit our unique index" from any other
// error thrown inside the transaction, so the outer catch knows to run the
// Gate 3 idempotency disambiguation instead of just rethrowing.
class RedemptionConflictError extends Error {
  constructor(couponId) {
    super("Redemption unique-index conflict");
    this.isRedemptionConflict = true;
    this.couponId = couponId;
  }
}

const diagnoseCouponRejection = async (code) => {
  const existing = await Coupon.findOne({ code });
  if (!existing) {
    return new AppError("Coupon not found", 404, {
      errors: [{ field: "code", message: "No coupon exists with this code" }],
    });
  }
  if (existing.status !== COUPON_STATUS.ACTIVE) {
    return new AppError("Coupon is paused", 400, {
      errors: [{ field: "code", message: "Coupon is not active" }],
    });
  }
  if (existing.expiresAt <= new Date()) {
    return new AppError("Coupon has expired", 400, {
      errors: [{ field: "code", message: "Coupon has expired" }],
    });
  }
  return new AppError("Coupon has been fully redeemed", 400, {
    errors: [{ field: "code", message: "Coupon usage limit reached" }],
  });
};

// ===========================================================================
// GATE 4 FIX — Multi-document consistency (Category D).
//
// Even with Gates 1-3 fixed, the coupon's usedCount $inc and the Redemption
// insert are still TWO separate write operations. If the process crashes,
// loses its DB connection, or the insert fails for an unrelated reason
// AFTER the coupon increment commits but BEFORE the redemption is written,
// usedCount is now permanently higher than the number of real APPLIED
// redemption rows — the audit in Gate 4's test catches exactly this.
//
// session.withTransaction wraps both writes so they commit or roll back
// together, atomically, across both collections. This requires MongoDB to
// be running as a replica set (a single standalone mongod can't run
// transactions) — if you're on a bare local mongod, the fix is `mongod
// --replSet rs0` plus `rs.initiate()` once, or use MongoDB Atlas (which is
// already a replica set). Flag this requirement in your TSD.
//
// withTransaction retries the whole callback on TransientTransactionError
// and retries just the commit on UnknownTransactionCommitResult — that
// retry behavior is built into the driver, not something we hand-roll here.
// ===========================================================================

// Atomically claims one "slot" for this user on this coupon, respecting
// coupon.perUserLimit. Mirrors Gate 1's pattern (findOneAndUpdate + $expr)
// but per (user, coupon) instead of coupon-wide — this is what lets
// perUserLimit be any number, not just 1.
const claimUserSlot = async (userId, couponId, perUserLimit, session) => {
  let usage = await UserCouponUsage.findOneAndUpdate(
    { userId, couponId, count: { $lt: perUserLimit } },
    { $inc: { count: 1 } },
    { new: true, session },
  );
  if (usage) return usage;

  // No matching doc: either this is the user's very first attempt on this
  // coupon (no counter exists yet), or the limit's already been hit
  // (counter exists but count >= perUserLimit). Try creating fresh — the
  // unique index on (userId, couponId) makes this safe under concurrency.
  try {
    const created = await UserCouponUsage.create(
      [{ userId, couponId, count: 1 }],
      { session },
    );
    return created[0];
  } catch (err) {
    if (err.code === 11000) return null; // limit genuinely reached
    throw err;
  }
};

export const redeemCouponService = async (
  userId,
  { code, orderId, orderAmount },
) => {
  const session = await mongoose.startSession();
  let redemptionResult;

  try {
    await session.withTransaction(async () => {
      // Step 1+2 (Gate 1): atomic claim, now inside the transaction.
      const coupon = await Coupon.findOneAndUpdate(
        {
          code,
          status: COUPON_STATUS.ACTIVE,
          expiresAt: { $gt: new Date() },
          $expr: { $lt: ["$usedCount", "$maxUses"] },
        },
        { $inc: { usedCount: 1 } },
        { new: true, session },
      );

      if (!coupon) {
        // Throwing inside withTransaction's callback aborts the transaction
        // (nothing partially committed) and rethrows out of withTransaction.
        throw await diagnoseCouponRejection(code);
      }

      // Gate 2: atomic claim on THIS user's personal limit for this coupon.
      const usage = await claimUserSlot(
        userId,
        coupon._id,
        coupon.perUserLimit,
        session,
      );
      if (!usage) {
        // throw new AppError("Per-user redemption limit reached", 400, {
        //   errors: [
        //     { field: "code", message: "Per-user redemption limit reached" },
        //   ],
        // });

        throw new RedemptionConflictError(coupon._id);

      }

      const discountAmount = calculateDiscount(coupon, orderAmount);
      const finalAmount = orderAmount - discountAmount;

      try {
        // Steps 3+4 (Gates 2+3): the partial unique index on
        // (couponId, userId) in redemptionModel.js enforces the per-user
        // limit atomically, in the SAME transaction as the coupon $inc.
        const created = await Redemption.create(
          [
            {
              couponId: coupon._id,
              userId,
              orderId,
              orderAmount,
              discountAmount,
              finalAmount,
              status: REDEMPTION_STATUS.APPLIED,
            },
          ],
          { session },
        );
        redemptionResult = created[0];
      } catch (err) {
        if (err.code === 11000) {
          throw new RedemptionConflictError(coupon._id);
        }
        throw err;
      }
    });

    return redemptionResult;
  }
  
  catch (err) {
    if (err.isRedemptionConflict) {
      const existing = await Redemption.findOne({
        couponId: err.couponId,
        userId,
        orderId,
        status: REDEMPTION_STATUS.APPLIED,
      });

      if (existing && existing.orderId === orderId) {
        return existing;
      }

    throw new AppError("Per-user redemption limit reached", 400, {
      errors: [{ field: "code", message: "Per-user redemption limit reached" }],
    });
  }
  throw err;
}
   finally {
    await session.endSession();
  }
};

// ===========================================================================
// Revert — admin-only.
//  Category A (findOneAndUpdate filter guards against reverting an
// already-reverted redemption twice ===========================================================================
export const revertRedemptionService = async (redemptionId) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      // Category A: filtering on status: APPLIED means a second concurrent
      // revert call (or a double-click) on the same id finds no match and
      // fails cleanly instead of double-decrementing usedCount.
      const redemption = await Redemption.findOneAndUpdate(
        { _id: redemptionId, status: REDEMPTION_STATUS.APPLIED },
        { status: REDEMPTION_STATUS.REVERTED },
        { new: true, session },
      );

      if (!redemption) {
        const existing =
          await Redemption.findById(redemptionId).session(session);
        if (!existing) {
          throw new AppError("Redemption not found", 404, {
            errors: [
              { field: "id", message: "Redemption not found with this id" },
            ],
          });
        }
        throw new AppError("Redemption has already been reverted", 400, {
          errors: [
            { field: "id", message: "Redemption is not in APPLIED status" },
          ],
        });
      }

      // usedCount: { $gt: 0 } is a defensive guard, not the primary
      // correctness mechanism — the APPLIED-only filter above already
      // guarantees this redemption was counted exactly once. Belt and
      // braces against usedCount ever going negative if data is ever
      // inconsistent for an unrelated reason.
      const coupon = await Coupon.findOneAndUpdate(
        { _id: redemption.couponId, usedCount: { $gt: 0 } },
        { $inc: { usedCount: -1 } },
        { new: true, session },
      );

      // Symmetric to the coupon decrement above — revert-then-redeem-again
      // should be legitimate under Gate 2 as well, not just Gate 1.
      await UserCouponUsage.findOneAndUpdate(
        {
          userId: redemption.userId,
          couponId: redemption.couponId,
          count: { $gt: 0 },
        },
        { $inc: { count: -1 } },
        { session },
      );

      if (!coupon) {
        throw new AppError(
          "Coupon usage count is already at zero — data inconsistency, investigate before reverting",
          500,
          {
            errors: [
              {
                field: "couponId",
                message: "usedCount underflow guard triggered",
              },
            ],
          },
        );
      }

      result = redemption;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

export const getRedemptionByIdService = async (id) => {
  const redemption = await Redemption.findById(id).populate(
    "couponId",
    "code discountType discountValue",
  );
  if (!redemption) {
    throw new AppError("Redemption not found with this id", 404, {
      errors: [{ field: "id", message: "Redemption not found with this id" }],
    });
  }
  return redemption;
};

// Ownership check (Module 2 pattern): userId comes from req.user.id in the
// controller — NEVER from a route param or the request body — so there is
// no way for one customer to pass another customer's id and see their
// history. This is what closes the exact IDOR class the userRouter comment
// warned about elsewhere in this codebase.
export const getMyRedemptionsService = async (userId, queryString) => {
  const features = new APIFeatures(Redemption.find({ userId }), queryString);
  await features.process();
  const redemptions = await features.query.populate(
    "couponId",
    "code discountType discountValue",
  );

  return {
    redemptions,
    pagination: {
      totalCount: features.totalCount,
      page: features.page,
      limit: features.limit,
    },
  };
};
