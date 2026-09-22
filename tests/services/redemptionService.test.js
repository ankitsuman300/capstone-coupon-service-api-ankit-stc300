import { jest } from "@jest/globals";

// A fake session whose withTransaction just calls the callback directly
// (no real DB, no real atomicity) — this lets us unit-test the SERVICE
// LOGIC (what gets called with what, how errors are handled) without a
// running MongoDB replica set. Whether the transaction is *actually* atomic
// against real concurrent writes is what the race-gate scripts verify
// against a live server — that's an integration/load concern, not a unit
// test concern, and the two are deliberately not the same test.
const fakeSession = {
  withTransaction: jest.fn(async (fn) => fn()),
  endSession: jest.fn(),
};

jest.unstable_mockModule("mongoose", () => ({
  default: {
    startSession: jest.fn(async () => fakeSession),
  },
}));

jest.unstable_mockModule("../../models/couponModel.js", () => ({
  default: {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
  },
  COUPON_STATUS: { ACTIVE: "ACTIVE", PAUSED: "PAUSED" },
}));

jest.unstable_mockModule("../../models/redemptionModel.js", () => ({
  default: {
    create: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(() => ({ session: jest.fn().mockResolvedValue(null) })),
  },
  REDEMPTION_STATUS: { APPLIED: "APPLIED", REVERTED: "REVERTED" },
}));

jest.unstable_mockModule("../../utils/apiFeatures.js", () => ({
  APIFeatures: jest.fn(),
}));

jest.unstable_mockModule("../../middlewares/appError.js", () => ({
  default: jest.fn(),
}));

const mongoose = (await import("mongoose")).default;
const Coupon = (await import("../../models/couponModel.js")).default;
const Redemption = (await import("../../models/redemptionModel.js")).default;
const { REDEMPTION_STATUS } = await import("../../models/redemptionModel.js");
const AppError = (await import("../../middlewares/appError.js")).default;
const {
  redeemCouponService,
  revertRedemptionService,
} = await import("../../services/redemptionService.js");

describe("RedemptionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // jest.config.js sets resetMocks: true, which wipes mock IMPLEMENTATIONS
    // (not just call history) before every test — including the ones set up
    // inside the unstable_mockModule factories above, since those only run
    // once at import time. Re-apply the default implementations every test.
    fakeSession.withTransaction.mockImplementation(async (fn) => fn());
    mongoose.startSession.mockImplementation(async () => fakeSession);
    Redemption.findById.mockReturnValue({
      session: jest.fn().mockResolvedValue(null),
    });
    AppError.mockImplementation((message, code, options) => {
      const error = new Error(message);
      error.statusCode = code;
      error.errors = options?.errors || [];
      return error;
    });
  });

  describe("redeemCouponService", () => {
    const payload = { code: "SAVE10", orderId: "order-1", orderAmount: 1000 };

    it("Gate 1: claims the coupon atomically and creates a redemption", async () => {
      const coupon = {
        _id: "c1",
        discountType: "PERCENT",
        discountValue: 10,
      };
      Coupon.findOneAndUpdate.mockResolvedValue(coupon);
      const redemption = { _id: "r1", status: REDEMPTION_STATUS.APPLIED };
      Redemption.create.mockResolvedValue([redemption]);

      const result = await redeemCouponService("user1", payload);

      // The maxUses check lives INSIDE the filter ($expr), not as a
      // separate read — this is the actual Gate 1 assertion worth making.
      expect(Coupon.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "SAVE10",
          $expr: { $lt: ["$usedCount", "$maxUses"] },
        }),
        { $inc: { usedCount: 1 } },
        expect.objectContaining({ new: true, session: fakeSession })
      );
      expect(Redemption.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            couponId: "c1",
            userId: "user1",
            orderId: "order-1",
            discountAmount: 100,
            finalAmount: 900,
            status: REDEMPTION_STATUS.APPLIED,
          }),
        ],
        { session: fakeSession }
      );
      expect(result).toBe(redemption);
      expect(fakeSession.endSession).toHaveBeenCalled();
    });

    it("rejects with a specific error when the coupon is exhausted", async () => {
      Coupon.findOneAndUpdate.mockResolvedValue(null);
      Coupon.findOne.mockResolvedValue({
        code: "SAVE10",
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(redeemCouponService("user1", payload)).rejects.toThrow(
        "Coupon has been fully redeemed"
      );
    });

    it("Gate 3: an E11000 conflict with the SAME orderId returns the original redemption (idempotent retry)", async () => {
      const coupon = { _id: "c1", discountType: "FLAT", discountValue: 100 };
      Coupon.findOneAndUpdate.mockResolvedValue(coupon);

      const duplicateKeyError = Object.assign(new Error("dup"), { code: 11000 });
      Redemption.create.mockRejectedValue(duplicateKeyError);

      const original = {
        _id: "r1",
        couponId: "c1",
        userId: "user1",
        orderId: "order-1", // SAME orderId as the incoming request
        status: REDEMPTION_STATUS.APPLIED,
      };
      Redemption.findOne.mockResolvedValue(original);

      const result = await redeemCouponService("user1", payload);

      expect(result).toBe(original);
    });

    it("Gate 2: an E11000 conflict with a DIFFERENT orderId is a real 'already redeemed' error", async () => {
      const coupon = { _id: "c1", discountType: "FLAT", discountValue: 100 };
      Coupon.findOneAndUpdate.mockResolvedValue(coupon);

      const duplicateKeyError = Object.assign(new Error("dup"), { code: 11000 });
      Redemption.create.mockRejectedValue(duplicateKeyError);

      Redemption.findOne.mockResolvedValue({
        _id: "r1",
        couponId: "c1",
        userId: "user1",
        orderId: "some-other-order", // DIFFERENT orderId
        status: REDEMPTION_STATUS.APPLIED,
      });

      await expect(redeemCouponService("user1", payload)).rejects.toThrow(
        "You have already redeemed this coupon"
      );
    });
  });

  describe("revertRedemptionService", () => {
    it("flips status to REVERTED and decrements usedCount atomically", async () => {
      const redemption = {
        _id: "r1",
        couponId: "c1",
        status: REDEMPTION_STATUS.REVERTED,
      };
      Redemption.findOneAndUpdate.mockResolvedValue(redemption);
      Coupon.findOneAndUpdate.mockResolvedValue({ _id: "c1", usedCount: 0 });

      const result = await revertRedemptionService("r1");

      expect(Redemption.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "r1", status: REDEMPTION_STATUS.APPLIED },
        { status: REDEMPTION_STATUS.REVERTED },
        expect.objectContaining({ new: true, session: fakeSession })
      );
      expect(Coupon.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "c1", usedCount: { $gt: 0 } },
        { $inc: { usedCount: -1 } },
        expect.objectContaining({ new: true, session: fakeSession })
      );
      expect(result).toBe(redemption);
    });

    it("rejects reverting a redemption that isn't APPLIED (already reverted)", async () => {
      Redemption.findOneAndUpdate.mockResolvedValue(null);
      Redemption.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue({
          _id: "r1",
          status: REDEMPTION_STATUS.REVERTED,
        }),
      });

      await expect(revertRedemptionService("r1")).rejects.toThrow(
        "Redemption has already been reverted"
      );
    });
  });
});
