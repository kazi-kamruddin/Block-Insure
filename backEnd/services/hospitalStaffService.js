const crypto = require("node:crypto");
const { promisify } = require("node:util");
const jwt = require("jsonwebtoken");
const HospitalStaff = require("../models/HospitalStaff");
const Hospital = require("../models/Hospital");

const scrypt = promisify(crypto.scrypt);
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const audience = "block-insure-hospital-staff";
const issuer = () => process.env.JWT_ISSUER || "block-insure-api";
const fail = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode });
const identity = (staff) => ({ staffId: String(staff._id), username: staff.username,
  displayName: staff.displayName, hospitalId: staff.hospitalId, role: "HOSPITAL", authMethod: "HOSPITAL_STAFF" });

const hashPassword = async (password) => {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw fail("Use a password of 12 to 128 characters.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, parameters);
  return `scrypt-v1:${salt}:${key.toString("hex")}`;
};

const verifyPassword = async (password, encoded) => {
  const [version, salt, digest] = String(encoded || "").split(":");
  const valid = version === "scrypt-v1" && /^[a-f0-9]{32}$/.test(salt || "") && /^[a-f0-9]{128}$/.test(digest || "");
  const computed = await scrypt(password, valid ? salt : "invalid-credential-dummy-salt", 64, parameters);
  return valid && crypto.timingSafeEqual(computed, Buffer.from(digest, "hex"));
};

const requireContractedHospital = async (hospitalId) => {
  const hospital = await Hospital.findOne({ hospitalId, networkStatus: "CONTRACTED" }).lean();
  if (!hospital) throw fail("Hospital access is unavailable or suspended.", 403);
  return hospital;
};

const authenticateStaff = async (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { audience, issuer: issuer(), algorithms: ["HS256"] });
  if (decoded.authMethod !== "HOSPITAL_STAFF" || !/^[a-f\d]{24}$/i.test(decoded.sub || "")) throw fail("Invalid hospital session.", 401);
  const staff = await HospitalStaff.findOne({ _id: decoded.sub, active: true }).select("+sessionVersion");
  if (!staff || staff.sessionVersion !== decoded.sessionVersion) throw fail("Hospital session expired or revoked.", 401);
  await requireContractedHospital(staff.hospitalId);
  return identity(staff);
};

const loginStaff = async (username, password) => {
  if (typeof username !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(username) ||
    typeof password !== "string" || password.length > 128) throw fail("Invalid hospital credentials.", 401);
  const staff = await HospitalStaff.findOne({ username: username.toLowerCase() }).select("+passwordHash +sessionVersion +failedLogins +lockedUntil");
  const matches = await verifyPassword(password, staff?.passwordHash);
  if (!staff || !staff.active || staff.lockedUntil > new Date() || !matches) {
    if (staff && !(staff.lockedUntil > new Date())) {
      const failures = staff.lockedUntil ? 1 : staff.failedLogins + 1;
      await HospitalStaff.updateOne({ _id: staff._id, failedLogins: staff.failedLogins }, { $set: {
        failedLogins: failures, lockedUntil: failures >= 5 ? new Date(Date.now() + 15 * 60000) : null,
      } });
    }
    throw fail("Invalid hospital credentials or temporarily locked account.", 401);
  }
  await requireContractedHospital(staff.hospitalId);
  await HospitalStaff.updateOne({ _id: staff._id }, { $set: { failedLogins: 0, lockedUntil: null } });
  const token = jwt.sign({ authMethod: "HOSPITAL_STAFF", sessionVersion: staff.sessionVersion }, process.env.JWT_SECRET,
    { algorithm: "HS256", subject: String(staff._id), audience, issuer: issuer(), expiresIn: "2h", jwtid: crypto.randomUUID() });
  return { token, staff: identity(staff), expiresAt: new Date(Date.now() + 2 * 3600000).toISOString() };
};

module.exports = { authenticateStaff, hashPassword, identity, loginStaff, requireContractedHospital, verifyPassword };
