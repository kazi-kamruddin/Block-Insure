// Serial, checkpoint-after-processing scanner. Dependencies keep local tests off public networks.
const createScanRecovery = ({ getHead, getNext, readRange, processEvent, persist,
  advance, onHead = () => {}, heartbeat = async () => {}, stopped = () => false,
  chunkSize = 2000, maxRanges = 10, budgetMs = 5000, pollMs = 15000,
  catchupDelayMs = 250, now = Date.now,
  yieldWork = () => new Promise(resolve => setImmediate(resolve)) }) => {
  let running = false, failures = 0;
  return async () => {
    if (running || stopped()) return { overlap: true, delayMs: pollMs };
    running = true;
    const started = now();
    let ranges = 0, head;
    try {
      head = await getHead();
      onHead(head);
      while (!stopped() && getNext() <= head && ranges < maxRanges && (ranges === 0 || now() - started < budgetMs)) {
        const from = getNext(), to = Math.min(head, from + chunkSize - 1);
        const events = await readRange(from, to);
        for (const event of events) {
          if (stopped()) return { stopped: true, delayMs: pollMs };
          const handled = await processEvent(event);
          if (handled === false) throw new Error('Oracle request remains unaccounted for');
        }
        if (stopped()) return { stopped: true, delayMs: pollMs };
        await persist(to + 1);
        advance(to + 1); // Never expose unacknowledged progress as the next cursor.
        ranges++;
        await yieldWork();
      }
      await heartbeat();
      failures = 0;
      return { ranges, head, delayMs: getNext() <= head ? catchupDelayMs : pollMs };
    } catch (error) {
      if (error.deferred) return { ranges, head, error, delayMs: pollMs };
      failures = Math.min(failures + 1, 8);
      return { ranges, head, error, delayMs: Math.min(120000, pollMs * 2 ** (failures - 1)) };
    } finally { running = false; }
  };
};

// Deadlines are inclusive in OracleCoordinator. Expiry is not fulfillment:
// the on-chain request remains available to the existing timeout/finalization path.
const requestDisposition = ({ request, revealed, eligible, committed, block }) => {
  if (request.isFulfilled || revealed) return 'complete';
  if (!eligible) return 'ineligible';
  if (block > Number(request.revealDeadlineBlock)) return 'expired-reveal';
  if (!committed && block > Number(request.commitDeadlineBlock)) return 'expired-commit';
  return committed ? 'reveal' : 'commit';
};
module.exports = { createScanRecovery, requestDisposition };
