import { jest } from "@jest/globals";

jest.unstable_mockModule("../../models/couponModel.js", () => ({
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    create: jest.fn(),
  },
  COUPON_STATUS: { ACTIVE: "ACTIVE", PAUSED: "PAUSED" },
  COUPON_DISCOUNT_TYPE: { PERCENT: "PERCENT", FLAT: "FLAT" },
}));

jest.unstable_mockModule("../../utils/apiFeatures.js", () => ({
  APIFeatures: jest.fn(),
}));

jest.unstable_mockModule("../../middlewares/appError.js", () => ({
  default: jest.fn(),
}));

const Coupon = (await import("../../models/couponModel.js")).default;
const { COUPON_STATUS } = await import("../../models/couponModel.js");
const { APIFeatures } = await import("../../utils/apiFeatures.js");
const AppError = (await import("../../middlewares/appError.js")).default;
const {
  getAllCouponsService,
  createCouponService,
  getCouponByIdService,
  updateCouponService,
  deleteCouponService,
} = await import("../../services/couponService.js");

describe("CouponService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppError.mockImplementation((message, code, options) => {
      const error = new Error(message);
      error.statusCode = code;
      error.errors = options?.errors || [];
      return error;
    });
  });

  describe("getAllCouponsService", () => {
    it("returns coupons with pagination via APIFeatures (no search)", async () => {
      const findQuery = { where: jest.fn() };
      Coupon.find.mockReturnValue(findQuery);
      const mockCoupons = [{ code: "SAVE10" }];
      APIFeatures.mockImplementation(() => ({
        process: jest.fn().mockResolvedValue(undefined),
        query: mockCoupons,
        totalCount: 1,
        page: 1,
        limit: 50,
      }));

      const result = await getAllCouponsService({ status: "ACTIVE" });

      expect(findQuery.where).not.toHaveBeenCalled();
      expect(APIFeatures).toHaveBeenCalledWith(findQuery, { status: "ACTIVE" });
      expect(result).toEqual({
        coupons: mockCoupons,
        pagination: { totalCount: 1, page: 1, limit: 50 },
      });
    });

    it("applies a case-insensitive code-fragment regex when search is present", async () => {
      const findQuery = { where: jest.fn() };
      Coupon.find.mockReturnValue(findQuery);
      APIFeatures.mockImplementation(() => ({
        process: jest.fn().mockResolvedValue(undefined),
        query: [],
        totalCount: 0,
        page: 1,
        limit: 50,
      }));

      await getAllCouponsService({ search: "save" });

      expect(findQuery.where).toHaveBeenCalledWith({
        code: { $regex: "save", $options: "i" },
      });
      // search must not leak into APIFeatures' own filter() as a literal field
      expect(APIFeatures).toHaveBeenCalledWith(findQuery, {});
    });
  });

  describe("createCouponService", () => {
    it("creates a coupon when the code is unique", async () => {
      Coupon.findOne.mockResolvedValue(null);
      const created = { _id: "c1", code: "SAVE10" };
      Coupon.create.mockResolvedValue(created);

      const result = await createCouponService({ code: "SAVE10" }, "admin1");

      expect(Coupon.create).toHaveBeenCalledWith({
        code: "SAVE10",
        createdBy: "admin1",
      });
      expect(result).toBe(created);
    });

    it("throws when the code already exists", async () => {
      Coupon.findOne.mockResolvedValue({ _id: "existing" });

      await expect(
        createCouponService({ code: "SAVE10" }, "admin1")
      ).rejects.toThrow("A coupon with this code already exists");
      expect(Coupon.create).not.toHaveBeenCalled();
    });
  });

  describe("getCouponByIdService", () => {
    it("returns the coupon when found", async () => {
      const coupon = { _id: "c1" };
      Coupon.findById.mockResolvedValue(coupon);
      const result = await getCouponByIdService("c1");
      expect(result).toBe(coupon);
    });

    it("throws 404 when not found", async () => {
      Coupon.findById.mockResolvedValue(null);
      await expect(getCouponByIdService("missing")).rejects.toThrow(
        "Coupon not found with this id"
      );
    });
  });

  describe("updateCouponService", () => {
    it("updates and returns the coupon", async () => {
      const updated = { _id: "c1", maxUses: 200 };
      Coupon.findByIdAndUpdate.mockResolvedValue(updated);

      const result = await updateCouponService("c1", { maxUses: 200 });

      expect(Coupon.findByIdAndUpdate).toHaveBeenCalledWith(
        "c1",
        { maxUses: 200 },
        { new: true, runValidators: true }
      );
      expect(result).toBe(updated);
    });

    it("throws 404 when not found", async () => {
      Coupon.findByIdAndUpdate.mockResolvedValue(null);
      await expect(
        updateCouponService("missing", { maxUses: 200 })
      ).rejects.toThrow("Coupon not found with this id");
    });
  });

  describe("deleteCouponService (pause, not hard delete)", () => {
    it("sets status to PAUSED via updateCouponService", async () => {
      const paused = { _id: "c1", status: COUPON_STATUS.PAUSED };
      Coupon.findByIdAndUpdate.mockResolvedValue(paused);

      const result = await deleteCouponService("c1");

      expect(Coupon.findByIdAndUpdate).toHaveBeenCalledWith(
        "c1",
        { status: COUPON_STATUS.PAUSED },
        { new: true, runValidators: true }
      );
      expect(result).toBe(paused);
    });
  });
});
