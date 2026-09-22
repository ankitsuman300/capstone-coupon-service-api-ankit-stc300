import express from "express";
import {
  getAllUsers,
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  loginUser,
  logoutUser,
  refreshUserAccessToken,
} from "../controllers/userController.js";
import { verifyToken, requireRole } from "../middlewares/auth.js";
import { validateRequest } from "../middlewares/validations.js";
import { USER_ROLES } from "../models/userModel.js";
import { loginRateLimiter } from "../middlewares/rateLimit.js";
import {
  createUserSchema,
  updateUserSchema,
} from "../utils/validationSchemas/userSchema.js";

const router = express.Router();

// ---------------------------------------------------------------------------
// Auth self-service (login/refresh/logout) stays open to any authenticated-
// enough caller — no role check makes sense here, you're establishing who
// you are, not acting on someone else's data yet.
//
// User CRUD below (list/create/update/delete) is admin-only per the Brief:
// "customers don't self-signup ... created by admins via User CRUD". Gating
// it with requireRole closes the IDOR this router used to have (previously
// any logged-in user — including a customer — could list/edit/delete ANY
// user by id, and POST "/" was fully public).
// ---------------------------------------------------------------------------

router.route("/login").post(loginRateLimiter, loginUser);

router
  .route("/update-refresh-access")
  .put(verifyToken("refresh"), refreshUserAccessToken);

router.route("/logout").delete(verifyToken("access"), logoutUser);

router
  .route("/")
  .get(verifyToken("access"), requireRole(USER_ROLES.ADMIN), getAllUsers)
  .post(
    verifyToken("access"),
    requireRole(USER_ROLES.ADMIN),
    validateRequest(createUserSchema),
    createUser
  );

router
  .route("/:id")
  .get(verifyToken("access"), requireRole(USER_ROLES.ADMIN), getUserById)
  .put(
    verifyToken("access"),
    requireRole(USER_ROLES.ADMIN),
    validateRequest(updateUserSchema),
    updateUser
  )
  .delete(verifyToken("access"), requireRole(USER_ROLES.ADMIN), deleteUser);

export default router;
