const {
  getIndexedEventsPage,
  indexConfirmedEvents,
} = require("../services/blockchainIndexerService");

const runIndexer = async (_req, res, next) => {
  try {
    res.status(200).json({ success: true, ...(await indexConfirmedEvents()) });
  } catch (error) {
    next(error);
  }
};

const listIndexedEvents = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      ...(await getIndexedEventsPage(req.query)),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { listIndexedEvents, runIndexer };
