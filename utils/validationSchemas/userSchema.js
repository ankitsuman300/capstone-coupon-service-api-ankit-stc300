import Joi from "joi";
import { USER_ROLES } from "../../models/userModel.js";

export const createUserSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .messages({
      "string.pattern.base": "Phone number must be 10 digits",
    })
    .required(),
  password: Joi.string().min(6).required(),
  // Admins create both admins and customers via this same endpoint (customers
  // don't self-signup per the Brief). Defaults to customer when omitted.
  role: Joi.string()
    .valid(...Object.values(USER_ROLES))
    .default(USER_ROLES.CUSTOMER),
});

export const updateUserSchema = Joi.object({
  name: Joi.string().optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .messages({
      "string.pattern.base": "Phone number must be 10 digits",
    })
    .optional(),
  password: Joi.string().min(6).optional(),
  role: Joi.string()
    .valid(...Object.values(USER_ROLES))
    .optional(),
  isActive: Joi.boolean().optional(),
}).min(1);
