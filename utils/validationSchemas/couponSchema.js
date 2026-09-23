import Joi from "joi";
import { COUPON_DISCOUNT_TYPE, COUPON_STATUS } from "../../models/couponModel.js";

const discountValueCheck = (value, helpers) => {
  const { discountType } = helpers.state.ancestors[0];
  if (discountType === COUPON_DISCOUNT_TYPE.PERCENT && value > 100) {
    return helpers.error("any.invalid", {
      message: "Percent discount cannot exceed 100",
    });
  }
  return value;
};

export const createCouponSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(3).max(30).required(),
  discountType: Joi.string()
    .valid(...Object.values(COUPON_DISCOUNT_TYPE))
    .required(),
  discountValue: Joi.number().min(0).required().custom(discountValueCheck),
  maxUses: Joi.number().integer().min(1).required(),
  perUserLimit: Joi.number().integer().min(1).default(1),
  expiresAt: Joi.date().iso().greater("now").required(),
});

export const updateCouponSchema = Joi.object({
  discountType: Joi.string()
    .valid(...Object.values(COUPON_DISCOUNT_TYPE))
    .optional(),
  discountValue: Joi.number().min(0).optional().custom(discountValueCheck),
  maxUses: Joi.number().integer().min(1).optional(),
  perUserLimit: Joi.number().integer().min(1).optional(),
  expiresAt: Joi.date().iso().optional(),
  status: Joi.string()
    .valid(...Object.values(COUPON_STATUS))
    .optional(),
}).min(1);
