import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import AppError from "./appError.js";

const rateLimitHandler = (req, res, next, options) => {
  next(
    new AppError("Too many requests, please try again later", 429, {
      errors: [{ field: null, message: options.message }],
    })
  );
};

// /login: rate-limited per IP, because the attacker doesn't have a valid
// account/token yet — an IP is the only identity we have pre-auth. Protects
// against credential-stuffing / brute-force password guessing.
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts, please try again in 15 minutes",
  handler: rateLimitHandler,
});

// /redeem: rate-limited per USER (not per IP — many customers can share an
// IP behind NAT/office wifi, and one user's own retries after a network
// flake shouldn't get more forgiving just because they're on a rare IP).
// keyGenerator runs after verifyToken, so req.user.id is always set here.
//
// IMPORTANT — this limit must stay comfortably ABOVE Gate 2's load (20
// parallel requests from ONE user within a fraction of a second). Gate 1's
// 200 parallel requests come from 200 DIFFERENT users, so it's naturally
// fine per-user — but Gate 2 sends all 20 from a single user, and if this
// limit sat at exactly 20 a stray extra request (a retry, a prior manual
// test) could get 429'd and be mistaken for the redemption logic itself
// rejecting it. Set with real headroom above the gate's test load, not
// tuned to the letter of it.
export const redeemRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many redemption attempts, please slow down",
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  handler: rateLimitHandler,
});
