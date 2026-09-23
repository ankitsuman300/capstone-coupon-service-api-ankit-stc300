import { catchAsync } from "../utils/helpers.js";
import AppSuccess from "../middlewares/appSuccess.js";
import AppError from "../middlewares/appError.js";
import {
  getAllCouponsService,
  createCouponService,
  getCouponByIdService,
  updateCouponService,
  deleteCouponService,
  getCouponAnalyticsService,
  startBulkImportJobService,
  getBulkImportJobStatusService
} from "../services/couponService.js";

export const getAllCoupons = catchAsync(async (req, res) => {
  const data = await getAllCouponsService(req.query);
  return new AppSuccess(res, {
    message: "Coupons fetched successfully",
    data,
  });
});

export const createCoupon = catchAsync(async (req, res) => {
  const coupon = await createCouponService(req.body, req.user.id);
  return new AppSuccess(res, {
    statusCode: 201,
    message: "Coupon created successfully",
    data: coupon,
  });
});

export const getCouponById = catchAsync(async (req, res) => {
  const coupon = await getCouponByIdService(req.params.id);
  return new AppSuccess(res, {
    message: "Coupon fetched successfully",
    data: coupon,
  });
});

export const updateCoupon = catchAsync(async (req, res) => {
  const coupon = await updateCouponService(req.params.id, req.body);
  return new AppSuccess(res, {
    message: "Coupon updated successfully",
    data: coupon,
  });
});

export const deleteCoupon = catchAsync(async (req, res) => {
  const coupon = await deleteCouponService(req.params.id);
  return new AppSuccess(res, {
    message: "Coupon paused successfully",
    data: coupon,
  });
});

export const getCouponAnalytics = catchAsync(async (req, res) => {
  const data = await getCouponAnalyticsService(req.query);
  return new AppSuccess(res, {
    message: "Analytics fetched successfully",
    data,
  });
});

export const bulkImportCoupons = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new AppError("No CSV file uploaded", 400);
  }
  const { jobId } = startBulkImportJobService(req.file.buffer, req.user.id);
  new AppSuccess(res, {
    statusCode: 202,
    message: "Import started",
    data: { jobId },
  });
});

export const getBulkImportStatus = catchAsync(async (req, res) => {
  const job = getBulkImportJobStatusService(req.params.jobId);
  new AppSuccess(res, { statusCode: 200, message: "Job status", data: job });
});
