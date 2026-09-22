import Joi from "joi";

export const redeemCouponSchema = Joi.object({
  code: Joi.string().trim().uppercase().required(),

  orderId: Joi.string().required(),
  orderAmount: Joi.number().min(0).required(),
});
