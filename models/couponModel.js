import mongoose from "mongoose";

const { Schema, model } = mongoose;

export const COUPON_DISCOUNT_TYPE = {
  PERCENT: "PERCENT",
  FLAT: "FLAT",
};

// PAUSED = admin-disabled (soft "delete" per the Brief: "delete/pause").
// EXPIRED is derived from expiresAt at read-time, not stored — see note below.
export const COUPON_STATUS = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
};

const couponSchema = new Schema(
  {
    code: {
      type: String,
      required: [true, "Coupon code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    discountType: {
      type: String,
      enum: Object.values(COUPON_DISCOUNT_TYPE),
      required: [true, "Discount type is required"],
    },
    // For PERCENT: 0-100. For FLAT: a rupee amount. Validated together in the
    // Joi schema (percent capped at 100) since Mongoose alone can't express
    // "min/max depends on a sibling field" cleanly.
    discountValue: {
      type: Number,
      required: [true, "Discount value is required"],
      min: 0,
    },
    maxUses: {
      type: Number,
      required: [true, "Max uses is required"],
      min: 1,
    },
    // Denormalized counter, kept in sync with actual APPLIED redemption rows
    // by the atomic $inc in the redeem/revert services (never edited directly
    // by an admin CRUD call). This is what Gate 1's findOneAndUpdate filter
    // checks against maxUses, and what Gate 4's transaction keeps consistent
    // with the Redemption collection.
    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    perUserLimit: {
      type: Number,
      default: 1,
      min: 1,
    },
    expiresAt: {
      type: Date,
      required: [true, "Expiry date is required"],
    },
    status: {
      type: String,
      enum: Object.values(COUPON_STATUS),
      default: COUPON_STATUS.ACTIVE,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// `code` already gets a unique index from `unique: true` above — that's what
// makes the redemption lookup (Coupon.findOne({ code })) and create-time
// duplicate check fast.
//
// This compound index backs the query every /redeem call runs (and Gate 1's
// atomic update filter): "find an ACTIVE, not-yet-expired coupon by code".
// It also backs the admin list's status filter.
couponSchema.index({ status: 1, expiresAt: 1 });

const Coupon = model("Coupon", couponSchema);
export default Coupon;
