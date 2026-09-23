import express from "express";
import userRouter from "./userRouter.js";
import adminRouter from "./adminRouter.js";
import publicRouter from "./publicRouter.js";
import redemptionRouter from "./redemptionRouter.js";
import { verifyToken, requireRole } from "../middlewares/auth.js";
import { USER_ROLES } from "../models/userModel.js";

const router = express.Router();

// Authenticated user resource (self-contained login/logout/refresh + CRUD).
router.use("/users", userRouter);

// Admin-gated resources.
// verifyToken proves the caller is authenticated;
// requireRole proves they're specifically an admin.
router.use(
  "/admin",
  verifyToken("access"),
  requireRole(USER_ROLES.ADMIN),
  adminRouter
);

// Redemption + a customer's own history — open to any authenticated user,
// role-specific gating happens per-route inside redemptionRouter where needed.
router.use("/redemptions", redemptionRouter);

// Public, unauthenticated resources (storefront-style reads + purchase).
router.use("/public", publicRouter);

export default router;
