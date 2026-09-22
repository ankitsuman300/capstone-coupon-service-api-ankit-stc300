import { catchAsync } from "../utils/helpers.js";
import AppSuccess from "../middlewares/appSuccess.js";
import Logger from "../utils/logger.js";
import {
  redeemCouponService,
  revertRedemptionService,
  getRedemptionByIdService,
  getMyRedemptionsService,
} from "../services/redemptionService.js";

export const redeemCoupon = catchAsync(async (req, res) => {
  const redemption = await redeemCouponService(req.user.id, req.body);
  Logger.log("info", "Coupon redeemed", {
    requestId: req.requestId,
    couponCode: req.body.code,
    userId: req.user.id,
    redemptionId: redemption._id.toString(),
  });
  return new AppSuccess(res, {
    statusCode: 201,
    message: "Coupon redeemed successfully",
    data: redemption,
  });
});

export const revertRedemption = catchAsync(async (req, res) => {
  const redemption = await revertRedemptionService(req.params.id);
  Logger.log("info", "Redemption reverted", {
    requestId: req.requestId,
    redemptionId: req.params.id,
    revertedBy: req.user.id,
  });
  return new AppSuccess(res, {
    message: "Redemption reverted successfully",
    data: redemption,
  });
});

export const getRedemptionById = catchAsync(async (req, res) => {
  const redemption = await getRedemptionByIdService(req.params.id);
  return new AppSuccess(res, {
    message: "Redemption fetched successfully",
    data: redemption,
  });
});

export const getMyRedemptions = catchAsync(async (req, res) => {
 
  const data = await getMyRedemptionsService(req.user.id, req.query);
  return new AppSuccess(res, {
    message: "Redemption history fetched successfully",
    data,
  });
});
