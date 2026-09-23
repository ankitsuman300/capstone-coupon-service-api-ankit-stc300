import mongoose from "mongoose";

const { Schema, model } = mongoose;

export const COUPON_DISCOUNT_TYPE = {
  PERCENT: "PERCENT",
  FLAT: "FLAT",
};

// PAUSED = admin-disabled (soft "delete" per the Brief: "delete/pause").
// EXPIRED is derived from expiresAt at read-time, not stored 
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

couponSchema.index({ status: 1, expiresAt: 1 });

const Coupon = model("Coupon", couponSchema);
export default Coupon;
