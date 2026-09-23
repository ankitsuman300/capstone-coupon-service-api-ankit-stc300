import mongoose from "mongoose";

const { Schema, model } = mongoose;

export const REDEMPTION_STATUS = {
  APPLIED: "APPLIED",
  REVERTED: "REVERTED",
};

// FIX — Per-user limit race 
// The naive version counted the user's existing APPLIED redemptions for
// this coupon IN JAVASCRIPT (Redemption.countDocuments), then created a new
// one in a later step.

const redemptionSchema = new Schema(
  {
    couponId: {
      type: Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
   
    orderId: {
      type: String,
      required: true,
    },
    orderAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    discountAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    finalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(REDEMPTION_STATUS),
      default: REDEMPTION_STATUS.APPLIED,
    },
  },
  { timestamps: true }
);


redemptionSchema.index({ userId: 1, createdAt: -1 });
redemptionSchema.index({ couponId: 1, createdAt: -1 });


redemptionSchema.index(
  { couponId: 1, userId: 1, orderId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "APPLIED" },
  }
);

// (idempotency) — unique on (couponId, userId, orderId): the same
// user retrying the same order against the same coupon can only ever
// create ONE APPLIED redemption row, no matter how many times the retry
// fires concurrently. 

const Redemption = model("Redemption", redemptionSchema);
export default Redemption;
