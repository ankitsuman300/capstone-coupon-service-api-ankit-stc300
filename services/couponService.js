import Coupon, { COUPON_STATUS } from "../models/couponModel.js";
import Redemption, { REDEMPTION_STATUS } from "../models/redemptionModel.js";
import { APIFeatures } from "../utils/apiFeatures.js";
import AppError from "../middlewares/appError.js";
import { parse } from "csv-parse/sync";
import { createCouponSchema } from "../utils/validationSchemas/couponSchema.js";
// Coupon model and AppError are presumably already imported at the top of this file
import { randomUUID } from "crypto";

export const getAllCouponsService = async (queryString) => {
  // APIFeatures already gives us filter (?status=ACTIVE), sort, pagination,
  // and field limiting for free. "Search by code fragment" (Brief) rides on
  // top of that: if a `search` query param is present, turn it into a
  // case-insensitive regex filter on `code` before handing off to APIFeatures.
  const mongoQuery = Coupon.find();
  const queryStringCopy = { ...queryString };

  if (queryStringCopy.search) {
    mongoQuery.where({
      code: { $regex: queryStringCopy.search, $options: "i" },
    });
    delete queryStringCopy.search;
  }

  const features = new APIFeatures(mongoQuery, queryStringCopy);
  await features.process();
  const coupons = await features.query;

  return {
    coupons,
    pagination: {
      totalCount: features.totalCount,
      page: features.page,
      limit: features.limit,
    },
  };
};

export const createCouponService = async (couponData, adminUserId) => {
  const existing = await Coupon.findOne({ code: couponData.code });
  if (existing) {
    throw new AppError("A coupon with this code already exists", 400, {
      errors: [{ field: "code", message: "Coupon code must be unique" }],
    });
  }
  const coupon = await Coupon.create({
    ...couponData,
    createdBy: adminUserId,
  });
  return coupon;
};

export const getCouponByIdService = async (id) => {
  const coupon = await Coupon.findById(id);
  if (!coupon) {
    throw new AppError("Coupon not found with this id", 404, {
      errors: [{ field: "id", message: "Coupon not found with this id" }],
    });
  }
  return coupon;
};

export const updateCouponService = async (id, couponData) => {
  const coupon = await Coupon.findByIdAndUpdate(id, couponData, {
    new: true,
    runValidators: true,
  });
  if (!coupon) {
    throw new AppError("Coupon not found with this id", 404, {
      errors: [{ field: "id", message: "Coupon not found with this id" }],
    });
  }
  return coupon;
};

// "delete/pause" per the Brief — we never hard-delete a coupon that may
// already have redemptions pointing at it (would orphan Redemption.couponId
// and break analytics/history). Pausing is the real operation; this stays
// named deleteCouponService to match the CRUD verb the route uses.
export const deleteCouponService = async (id) => {
  const coupon = await updateCouponService(id, {
    status: COUPON_STATUS.PAUSED,
  });
  return coupon;
};

// Analytics: top-N coupons by redemption count + a summary. Runs as a single
// aggregation pipeline against Redemption (the source of truth for actual
// usage) rather than trusting Coupon.usedCount for the ranking — usedCount
// is a denormalized counter for the hot path (Gate 1's atomic check), while
// this is a read-heavy, infrequent admin query where the extra $group cost
// is fine and gives you a number that's independently verifiable against
// the Redemption collection.
export const getCouponAnalyticsService = async ({ limit = 5 } = {}) => {
  const topCoupons = await Redemption.aggregate([
    { $match: { status: REDEMPTION_STATUS.APPLIED } },
    {
      $group: {
        _id: "$couponId",
        redemptionCount: { $sum: 1 },
        totalDiscountValue: { $sum: "$discountAmount" },
      },
    },
    { $sort: { redemptionCount: -1 } },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: "coupons",
        localField: "_id",
        foreignField: "_id",
        as: "coupon",
      },
    },
    { $unwind: "$coupon" },
    {
      $project: {
        _id: 0,
        couponId: "$_id",
        code: "$coupon.code",
        redemptionCount: 1,
        totalDiscountValue: 1,
      },
    },
  ]);

  const [summary] = await Redemption.aggregate([
    { $match: { status: REDEMPTION_STATUS.APPLIED } },
    {
      $group: {
        _id: null,
        totalRedemptions: { $sum: 1 },
        totalDiscountValue: { $sum: "$discountAmount" },
      },
    },
  ]);

  return {
    topCoupons,
    summary: {
      totalRedemptions: summary?.totalRedemptions || 0,
      totalDiscountValue: summary?.totalDiscountValue || 0,
    },
  };
};

const MAX_ROWS = 1000; // sanity cap on a single import job


const importJobs = new Map();

const JOB_TTL_MS = 60 * 60 * 1000;
const sweepOldJobs = () => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of importJobs) {
    if (job.status !== "processing" && job.finishedAt && job.finishedAt < cutoff) {
      importJobs.delete(id);
    }
  }
};

const runImportJob = async (job, records, createdBy) => {
  for (let i = 0; i < records.length; i++) {
    const rowNumber = i + 2;
    const row = records[i];

    const payload = {
      code: row.code?.trim().toUpperCase(),
      discountType: row.discountType?.trim().toUpperCase(),
      discountValue: Number(row.discountValue),
      maxUses: Number(row.maxUses),
      perUserLimit: Number(row.perUserLimit),
      expiresAt: row.expiresAt,
    };

    const { error, value } = createCouponSchema.validate(payload, { abortEarly: false });
    if (error) {
      job.failCount++;
      job.errors.push({
        row: rowNumber,
        code: row.code || "(missing)",
        message: error.details.map((d) => d.message).join(", "),
      });
    } else {
      try {
        await Coupon.create({ ...value, createdBy });
        job.successCount++;
      } catch (err) {
        job.failCount++;
        const message = err.code === 11000 ? "Coupon code already exists" : err.message;
        job.errors.push({ row: rowNumber, code: row.code, message });
      }
    }

    job.processed = i + 1;
  }

  job.status = "completed";
  job.finishedAt = Date.now();
};

export const startBulkImportJobService = (csvBuffer, createdBy) => {
  let records;
  try {
    records = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    throw new AppError("Could not parse the CSV file — check it's valid CSV with a header row", 400);
  }

  if (records.length > MAX_ROWS) {
    throw new AppError(`CSV has ${records.length} rows — split it into batches of ${MAX_ROWS} or fewer`, 400);
  }

  sweepOldJobs();

  const jobId = randomUUID();
  const job = {
    jobId,
    status: "processing",
    total: records.length,
    processed: 0,
    successCount: 0,
    failCount: 0,
    errors: [],
    startedAt: Date.now(),
    finishedAt: null,
  };
  importJobs.set(jobId, job);

  runImportJob(job, records, createdBy).catch((err) => {
    job.status = "failed";
    job.finishedAt = Date.now();
    job.errors.push({ row: null, code: null, message: err.message });
  });

  return { jobId };
};

export const getBulkImportJobStatusService = (jobId) => {
  const job = importJobs.get(jobId);
  if (!job) {
    throw new AppError("Import job not found", 404, {
      errors: [{ field: "jobId", message: "No import job with this id (it may have expired, or the server restarted)" }],
    });
  }
  return { ...job };
};