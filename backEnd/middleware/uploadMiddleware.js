const multer = require("multer");

const storage = multer.memoryStorage();

const allowedMimeTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/octet-stream",
];

const fileFilter = (req, file, cb) => {
  if (!allowedMimeTypes.includes(file.mimetype)) {
    const error = new Error("Only PDF, JPG, PNG, or encrypted evidence files are allowed");
    error.statusCode = 415;
    return cb(error, false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
});

const single = upload.single.bind(upload);
upload.single = (fieldName) => {
  const parse = single(fieldName);
  return (req, res, next) => parse(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      error.statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    } else if (error && !error.statusCode) {
      error.statusCode = 400;
    }
    next(error);
  });
};

module.exports = upload;
