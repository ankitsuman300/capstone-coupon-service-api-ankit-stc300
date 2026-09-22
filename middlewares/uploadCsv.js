import multer from "multer";
import AppError from "./appError.js";   

const storage = multer.memoryStorage(); // no disk write — we only need the buffer for one parse

const fileFilter = (req, file, cb) => {
  const isCsv =
    file.mimetype === "text/csv" ||
    file.mimetype === "application/vnd.ms-excel" ||
    file.originalname.toLowerCase().endsWith(".csv");
  if (!isCsv) return cb(new AppError("Only .csv files are allowed", 400));
  cb(null, true);
};

export const uploadCsv = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB — plenty for a coupon list
}).single("file"); // form field must be named "file"