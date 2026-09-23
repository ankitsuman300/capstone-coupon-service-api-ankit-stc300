import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import AppError from "./appError.js";

const rateLimitHandler = (req, res, next, options) => {
  next(
    new AppError("Too many requests, please try again later", 429, {
      errors: [{ field: null, message: options.message }],
    })
  );
};

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts, please try again in 15 minutes",
  handler: rateLimitHandler,
});

// /redeem: rate-limited per USER (not per IP — many customers can share an
// IP behind NAT/office wifi. 

export const redeemRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many redemption attempts, please slow down",
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  handler: rateLimitHandler,
});
