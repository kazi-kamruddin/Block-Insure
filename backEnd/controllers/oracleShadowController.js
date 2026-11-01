const service = require("../services/oracleShadowService");
const handle = (operation) => async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  try { res.json({ success: true, data: await service[operation](req.body) }); }
  catch (failure) {
    const statusCode = [400, 401, 403, 409].includes(failure.statusCode) ? failure.statusCode : 503;
    next(Object.assign(new Error(statusCode === 503 ? "Shadow assessment temporarily unavailable" : "Shadow request rejected"), { statusCode }));
  }
};
module.exports = { getShadowPacket: handle("getPacket"), saveShadowReport: handle("saveReport") };
