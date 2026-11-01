const { authenticateStaff } = require("../services/hospitalStaffService");

module.exports = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Hospital staff login required." });
    req.user = await authenticateStaff(header.slice(7));
    next();
  } catch (error) {
    const status = error.statusCode || (error.name?.includes("Token") ? 401 : 503);
    res.status(status).json({ success: false, message: status === 503 ? "Hospital session verification unavailable." : "Hospital session expired, revoked or access suspended." });
  }
};
