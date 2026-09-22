import express from "express";
import { redeemCoupon, getMyRedemptions } from "../controllers/redemptionController.js";
import { verifyToken } from "../middlewares/auth.js";
import { validateRequest } from "../middlewares/validations.js";
import { redeemCouponSchema } from "../utils/validationSchemas/redemptionSchema.js";
import { redeemRateLimiter } from "../middlewares/rateLimit.js";

// Both roles can redeem per the Brief ("Customer + Admin: Redemption page"),
// so this only requires authentication, not a specific role.
const router = express.Router();

router.post(
  "/redeem",
  verifyToken("access"),
  redeemRateLimiter,
  validateRequest(redeemCouponSchema),
  redeemCoupon
);

// Own-history — ownership is enforced in the controller via req.user.id,
// not by a role check, so both customers and admins can see THEIR OWN
// redemptions here.
router.get("/my", verifyToken("access"), getMyRedemptions);

export default router;
