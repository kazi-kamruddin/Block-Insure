const express = require("express");
const { rateLimit } = require("express-rate-limit");
const HospitalStaff = require("../models/HospitalStaff");
const authMiddleware = require("../middleware/authMiddleware");
const staffAuth = require("../middleware/hospitalStaffAuth");
const { requireRole } = require("../middleware/roleMiddleware");
const { hashPassword, identity, loginStaff, requireContractedHospital } = require("../services/hospitalStaffService");
const { logAdminAction } = require("../services/adminActionLogService");
const router = express.Router();
const loginLimit = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
router.post("/login", loginLimit, async (req, res, next) => {
  try {
    const result = await loginStaff(req.body.username, req.body.password);
    req.user = result.staff;
    await logAdminAction({ req, action: "HOSPITAL_STAFF_LOGIN", targetType: "HospitalStaff", targetId: result.staff.staffId });
    res.set("Cache-Control", "no-store").json({ success: true, ...result });
  } catch (error) { next(error); }
});
router.get("/session", staffAuth, (req, res) => res.set("Cache-Control", "no-store").json({ success: true, staff: req.user }));
router.post("/logout", staffAuth, async (req, res, next) => {
  try {
    await HospitalStaff.updateOne({ _id: req.user.staffId }, { $inc: { sessionVersion: 1 } });
    await logAdminAction({ req, action: "HOSPITAL_STAFF_LOGOUT", targetType: "HospitalStaff", targetId: req.user.staffId });
    res.json({ success: true });
  } catch (error) { next(error); }
});
router.get("/accounts", authMiddleware, requireRole("ADMIN"), async (req, res, next) => {
  try { res.json({ success: true, staff: (await HospitalStaff.find().limit(200)).map((staff) => ({ ...identity(staff), active: staff.active })) }); }
  catch (error) { next(error); }
});
router.post("/accounts", authMiddleware, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { username, displayName, hospitalId, password } = req.body;
    if (typeof username !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(username) ||
      typeof displayName !== "string" || !displayName.trim() || displayName.length > 100 || typeof hospitalId !== "string") {
      return res.status(422).json({ success: false, message: "Supply a valid username, display name and hospital ID." });
    }
    const hospital = await requireContractedHospital(hospitalId.trim().toUpperCase());
    const staff = await HospitalStaff.create({ username, displayName, hospitalId: hospital.hospitalId, passwordHash: await hashPassword(password) });
    await logAdminAction({ req, action: "HOSPITAL_STAFF_PROVISIONED", targetType: "HospitalStaff", targetId: staff.id, metadata: { hospitalId: staff.hospitalId } });
    res.status(201).json({ success: true, staff: identity(staff) });
  } catch (error) { if (error.code === 11000) error = Object.assign(new Error("Staff username already exists."), { statusCode: 409 }); next(error); }
});
router.patch("/accounts/:id", authMiddleware, requireRole("ADMIN"), async (req, res, next) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(422).json({ success: false, message: "Invalid staff identifier." });
    const changes = {};
    if (req.body.active !== undefined) {
      if (typeof req.body.active !== "boolean") return res.status(422).json({ success: false, message: "active must be a boolean." });
      changes.active = req.body.active;
    }
    if (req.body.password !== undefined) {
      changes.passwordHash = await hashPassword(req.body.password);
      changes.failedLogins = 0; changes.lockedUntil = null;
    }
    if (!Object.keys(changes).length) return res.status(422).json({ success: false, message: "Supply a password reset or active status." });
    const staff = await HospitalStaff.findByIdAndUpdate(req.params.id, { $set: changes, $inc: { sessionVersion: 1 } }, { returnDocument: "after", runValidators: true });
    if (!staff) return res.status(404).json({ success: false, message: "Staff account not found." });
    await logAdminAction({ req, action: "HOSPITAL_STAFF_ACCESS_CHANGED", targetType: "HospitalStaff", targetId: staff.id, metadata: { active: staff.active, passwordReset: changes.passwordHash !== undefined } });
    res.json({ success: true, staff: { ...identity(staff), active: staff.active } });
  } catch (error) { next(error); }
});
module.exports = router;
