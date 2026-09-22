import express from "express";
import {
  getRedemptionById,
  revertRedemption,
} from "../controllers/redemptionController.js";

// Admin-only. Auth + role are enforced at the mount point in indexRouter.js.
const router = express.Router();

router.get("/:id", getRedemptionById);
router.patch("/:id/revert", revertRedemption);

export default router;
