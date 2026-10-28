const { statusFor, prepareBatch, resumeBatch } = require("../services/reviewAccessService");
const status = async (req, res, next) => { try { res.json({ success: true, preparation: await statusFor(req.params.claimId, req.user) }); } catch (error) { next(error); } };
const authorize = async (req, res, next) => { try { res.status(202).json({ success: true, preparation: await prepareBatch(req.params.claimId, req.user.walletAddress, req.body) }); } catch (error) { next(error); } };
const resume = async (req, res, next) => { try { res.status(202).json({ success: true, preparation: await resumeBatch(req.params.claimId, req.user) }); } catch (error) { next(error); } };
module.exports = { status, authorize, resume };
