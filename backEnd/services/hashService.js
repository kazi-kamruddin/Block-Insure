const crypto = require("crypto");

const calculateSHA256 = (fileBuffer) => {
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
};

const calculateTextSHA256 = (value) => {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
};

module.exports = {
  calculateSHA256,
  calculateTextSHA256,
};
