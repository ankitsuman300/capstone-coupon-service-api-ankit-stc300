import crypto from "crypto";

  // RequestId to every incoming request

export const correlationId = (req, res, next) => {
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};
