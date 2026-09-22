import express from "express";
import productRouter from "./productRouter.js";
import couponRouter from "./couponRouter.js";
import adminRedemptionRouter from "./adminRedemptionRouter.js";

// Admin routes are gated by verifyToken("access") + requireRole("admin")
// where this router is mounted (see indexRouter.js).
const router = express.Router({ mergeParams: true });

router.use("/products", productRouter);
router.use("/coupons", couponRouter);
router.use("/redemptions", adminRedemptionRouter);

export default router;
