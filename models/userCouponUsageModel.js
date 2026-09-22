import mongoose from "mongoose";

const { Schema, model } = mongoose;

// One document per (user, coupon) pair — how many times THIS user has
// redeemed THIS coupon. This is what makes perUserLimit > 1 possible: Gate
// 2 becomes "at most N", checked the same atomic way Gate 1 checks
// usedCount against maxUses on the Coupon document.
const userCouponUsageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", required: true },
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Exactly one counter document per (user, coupon) pair, ever — this is
// what makes "create it if it doesn't exist yet" safe under concurrency in
// redeemCouponService: two simultaneous first-time attempts can't both
// create a counter doc; the second gets E11000 and is treated as "limit
// reached" (since the fast-path increment already failed for it too).
userCouponUsageSchema.index({ userId: 1, couponId: 1 }, { unique: true });

const UserCouponUsage = model("UserCouponUsage", userCouponUsageSchema);
export default UserCouponUsage;