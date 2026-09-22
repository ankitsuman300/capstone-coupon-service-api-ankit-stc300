import express from "express";
import {
  getAllCoupons,
  createCoupon,
  getCouponById,
  updateCoupon,
  deleteCoupon,
  getCouponAnalytics,
  getBulkImportStatus
} from "../controllers/couponController.js";
import { validateRequest } from "../middlewares/validations.js";
import {
  createCouponSchema,
  updateCouponSchema,
} from "../utils/validationSchemas/couponSchema.js";
import { uploadCsv } from "../middlewares/uploadCsv.js";
import { bulkImportCoupons } from "../controllers/couponController.js";


// Admin-only. Auth + role are enforced at the mount point in indexRouter.js
// ("/admin" -> verifyToken + requireRole("admin")), so everything here
// assumes an authenticated admin caller.
const router = express.Router();

// Must be registered BEFORE "/:id" — otherwise Express would try to treat
// "analytics" as a coupon id and 404/cast-error on that route instead.
router.get("/analytics", getCouponAnalytics);

router
  .route("/")
  .get(getAllCoupons)
  .post(validateRequest(createCouponSchema), createCoupon);

router
  .route("/:id")
  .get(getCouponById)
  .put(validateRequest(updateCouponSchema), updateCoupon)
  .delete(deleteCoupon);

  router.post("/bulk-import", uploadCsv, bulkImportCoupons);
router.get("/bulk-import/:jobId/status", getBulkImportStatus);

  
export default router;
