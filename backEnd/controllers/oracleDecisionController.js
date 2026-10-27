const { decision } = require("../services/oracleDecisionService");
const handle = (save) => async (req, res, next) => {
  try { res.set("Cache-Control", "no-store"); res.json({ success: true, data: await decision(req.body, save) }); }
  catch (error) { next(Object.assign(new Error("Protocol decision could not be read or recorded"), { statusCode: [400, 401, 403, 409].includes(error.statusCode) ? error.statusCode : 503 })); }
};
module.exports = { readDecision: handle(false), saveDecision: handle(true) };
