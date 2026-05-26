const crypto = require("crypto");

const calculateSHA256 = (fileBuffer) => {
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
};

module.exports = {
  calculateSHA256,
};