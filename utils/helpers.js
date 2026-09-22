import bcrypt from "bcryptjs";
import crypto from "crypto";
import ms from "ms";
import moment from "moment";
import AppError from "../middlewares/appError.js";

export const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const comparePassword = async (plainPassword, hashedPassword) => {
  return bcrypt.compare(plainPassword, hashedPassword);
};

export const generateSessionId = () => {
  return crypto.randomBytes(16).toString("hex");
};

export const calculateRefreshExpiresAt = (expiresIn) => {
  const milliseconds = ms(expiresIn);
  if (!milliseconds) {
    throw new AppError("Invalid expiration format", 400, {
      errors: [
        {
          field: "expiresIn",
          message: "Invalid expiration format",
        },
      ],  
    });
  }
  return new Date(Date.now() + milliseconds);
};

export const formatDate = (date) => {
  if (!date) return null;
  return moment(date).format("DD/MM/YYYY"); // Format dob in DD/MM/YYYY
};

// Shared by the redemption service (and easy to unit test in isolation from
// any DB call). PERCENT is capped implicitly by discountValue<=100 at the
// Joi layer; FLAT is capped here so a flat coupon larger than the order
// can't produce a negative finalAmount.
export const calculateDiscount = (coupon, orderAmount) => {
  if (coupon.discountType === "PERCENT") {
    return Math.round((orderAmount * coupon.discountValue) / 100);
  }
  // FLAT
  return Math.min(coupon.discountValue, orderAmount);
};
