const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { amount, digest } = require("./manifest");
const { registryRoot } = require("../../oracle/shadowAssessment");
const { buildEpisode, createOracleFixtures, clarificationAuthorization } = require("./localFixtures");
const { materialize, operationFingerprint, executeIntent, rowFor, openJournal } = require("./runner");

const JSON_BIGINT = (_, value) => typeof value === "bigint" ? value.toString() : value;
const roleAliases = ["holder", "auditor1", "auditor2", "auditor3", "auditor4"];
const MANAGER = "InsuranceManager", PANEL = "ClaimAdjudicator", ORACLE = "OracleCoordinator";
const ECONOMICS = "PolicyEconomics", BENEFITS = "PolicyBenefitsManager", BANK = "BankIdentityRegistry", EVIDENCE = "EvidenceRegistry";
const tuple = (name, fields, values) => ({ component: name[0], signature: name[1], args: name[2], fields, equals: values });
const read = (component, signature, args, equals) => ({ component, signature, args, equals });
const caps = { maxFeePerGasWei: "5000000000", priorityWei: "1000000000" };

function loadComponents(deployment, provider) {
  return Object.fromEntries(Object.entries(deployment.components).map(([name, address]) => {
    const implementation = name === PANEL ? "ClaimAdjudicatorV6" : name === MANAGER ? "AcceleratedInsuranceManager" : name;
    const artifact = require("../../contracts/artifacts/contracts/" + implementation + ".sol/" + implementation + ".json");
    return [name, new ethers.Contract(address, artifact.abi, provider)];
  }));
}

function struct(component, contract, method, args) {
  return [component, contract.interface.getFunction(method).format("full").replace(/^function /, ""), args];
}

async function localAdapter({ provider, manifest, deployment, manifestHash, chainId, signers, evidence, directory, deploymentManifestHash, startTime }) {
  if (![31337, 11155111].includes(chainId) || (await provider.getNetwork()).chainId !== BigInt(chainId) ||
      !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(provider._getConnection().url)) throw new Error("The fixture adapter admits only an isolated loopback Hardhat");
  const [client, head] = await Promise.all([provider.send("web3_clientVersion", []), provider.getBlock("latest")]);
  const previouslyExecuted = manifest.operations.filter((step) => step.category === "bootstrap" ||
    /^setup\.(oracle[12]|auditor[1-4]|bank|medical-reserve)$/.test(step.id));
  if (!/hardhat/i.test(client) || !head || head.number !== previouslyExecuted.length) {
    throw new Error("Select a fresh, role-bootstrapped Hardhat");
  }
  const receiptsAtHead = async () => {
    const tip = await provider.getBlockNumber();
    let transactions = 0;
    for (let block = 1; block <= tip; block += 1) {
      transactions += Number(await provider.send("eth_getBlockTransactionCountByNumber", [ethers.toQuantity(block)]));
    }
    return transactions;
  };
  const actors = Object.fromEntries(Object.entries(signers).map(([name, signer]) => [name, signer.address]));
  const holder = actors.holder;
  const contracts = loadComponents(deployment, provider);
  const manager = contracts[MANAGER], coordinator = contracts[ORACLE], panel = contracts[PANEL];
  const benefits = contracts[BENEFITS], economics = contracts[ECONOMICS], bank = contracts[BANK];
  const evaluate = createOracleFixtures({ provider, coordinator, manager, chainId, signers });
  const policies = new Map(), claims = new Map(), episodes = new Map(), documents = new Map(), requests = new Map();
  const archives = new Map(), grants = new Map(), observations = [], rows = [];
  const premium = amount(manifest.deployment.premiumEth, "premium");
  const purchaseNames = ["routine", "manual", "rejected", "clarification", "surgery", "refund"];
  const substitution = new Map(Object.entries(actors).map(([role, address]) => [address.toLowerCase(), "$role." + role]));
  Object.entries(deployment.components).forEach(([name, address]) => substitution.set(address.toLowerCase(), "$component." + name));
  const ledgerDirectory = path.join(directory, "workflow");
  const ledgerIdentity = { type: "isolated-workflow", chainId, manifestHash, deploymentManifestHash };
  let ledger = openJournal(ledgerDirectory, ledgerIdentity);
  const bankAuthorization = { otp: null, mandate: null };
  const clockAdvances = [];
  let clarification, refundId, interrupt;
  let logicalTime = BigInt(Math.max(startTime, head.timestamp + 1));
  const claimStatus = (id, status) => tuple(struct(MANAGER, manager, "getClaim", [id]), ["status"], [status]);
  const requestCount = (count) => read(ORACLE, "requestCounter() view returns(uint256)", [], count);
  const benefitStatus = (id, status) => tuple(struct(BENEFITS, benefits, "getBenefitRequest", [id]), ["status"], [status]);
  const policyPayments = (id, count) => tuple(struct(MANAGER, manager, "getPolicy", [id]), ["installmentsPaid"], [count]);
  const versionOf = (id, version) => read(MANAGER, "claimVersion(uint256) view returns(uint64)", [id], version);
  const settings = { chainId, manifestHash, deployment, pollMs: 100, receiptTimeoutMs: 15000, captureLocalEncoding: true,
    checkBudget: async (item) => {
      const floor = item.step.role === "admin" ? amount(manifest.budget.adminRetainedEth, "admin retained") : 0n;
      const available = await provider.getBalance(item.from);
      if (available < floor + item.tx.value + BigInt(item.detail.gasLimit) * BigInt(caps.maxFeePerGasWei)) throw new Error("Local runner wallet budget exceeded");
    },
  };

  function recordObservation(step, outcome) {
    const record = { schema: "block-insure-paired-app-observation/v1", source: "isolated fixture adapter",
      method: step.method, operationId: step.id, chainId, manifestHash, deploymentManifestHash, status: "confirmed",
      observedAt: new Date().toISOString(), outcome };
    const json = JSON.stringify(record, JSON_BIGINT, 2) + "\n";
    const file = path.join(directory, "workflow", step.id + ".json");
    fs.writeFileSync(file, json, { flag: "wx" });
    const evidenceSha256 = digest(json);
    ledger.append({ type: "observation", operationId: step.id, evidenceSha256 });
    observations.push({ operationId: step.id, evidenceSha256 });
  }

  function profile(name) {
    if (name === "routine" || name === "surgery") return manifest.cases[name];
    if (name === "clarification-corrected" || name === "appeal") return { ...manifest.cases.routine, grossEth: manifest.cases.manual.grossEth };
    return manifest.cases.manual;
  }

  async function installment() {
    const id = policies.get("refund");
    const policy = await manager.getPolicy(id);
    const quote = await economics.getInstallmentQuote(id, policy.nextPremiumDueDate);
    if (!quote.payableNow) {
      const before = await provider.getBlock("latest");
      logicalTime = BigInt(quote.opensAt);
      await provider.send("evm_setNextBlockTimestamp", [Number(logicalTime)]);
      await provider.send("evm_mine", []);
      clockAdvances.push({ from: before.timestamp, to: Number(logicalTime), installmentId: String(quote.installmentId) });
      logicalTime += 1n;
    }
    const latest = await economics.getInstallmentQuote(id, policy.nextPremiumDueDate);
    assert(latest.payableNow && latest.amountWei === premium);
    return { id, transferInstallment: latest.installmentId, paid: policy.installmentsPaid };
  }

  async function observe(step, name, action) {
    if (action === "episode") {
      const spec = profile(name);
      const incident = (await manager.getPolicy(policies.get(name))).startDate;
      const row = buildEpisode({ name, holder, profile: spec, expected: spec.expectedBillEth, incident });
      episodes.set(name, { row, incident });
      return { invoiceHash: row.invoiceHash, authorizedWallet: holder, grossEth: spec.grossEth };
    }
    if (action === "encrypted-evidence" || step.id === "appeal.evidence" || step.id === "clarification.answer-evidence") {
      const stage = step.id === "clarification.answer-evidence" ? "clarification-corrected" : name;
      const source = stage === "appeal" ? "rejected" : stage === "clarification-corrected" ? "clarification" : stage;
      const episode = episodes.get(source);
      const sealed = evidence.seal(stage, { invoice: episode.row.invoiceHash });
      documents.set(stage, sealed);
      return sealed;
    }
    if (action === "access") {
      const review = await panel.getReview(claims.get(name), 1);
      assert.equal(review.auditors.length, 4);
      assert.deepEqual([...review.auditors].sort(), roleAliases.slice(1).map((role) => actors[role]).sort());
      const proof = evidence.prepare(name);
      grants.set(name, proof);
      return proof;
    }
    if (step.id === "clarification.ask") {
      const claimId = claims.get(name);
      const prior = await manager.getClaim(claimId);
      assert.equal(prior.status, 5n);
      const deadline = (await manager.manualReviewEligibleAt(claimId)) - 1n;
      assert(deadline > logicalTime);
      clarification = { claimId, deadline, version: await manager.claimVersion(claimId) };
      return { claimId, deadline, question: "Provide the matching priced invoice clarification." };
    }
    if (step.category === "premium") {
      if (step.id === "premium.eft-cancel") {
        assert.equal(bankAuthorization.mandate?.status, "settled");
        bankAuthorization.mandate.status = "cancelled";
        return { mandateStatus: bankAuthorization.mandate.status, furtherDebitAuthorized: false };
      }
      const quote = await installment();
      const method = step.id === "premium.otp-authorize" ? "otp" : "mandate";
      assert.equal(bankAuthorization[method], null);
      bankAuthorization[method] = { ...quote, status: "authorized" };
      return { ...quote, authorization: method + " fixture", status: "authorized" };
    }
    throw new Error("Unbound paired observation " + step.id);
  }

  async function spendOrSetup(step, name, action) {
    if (action.startsWith("identity-")) {
      const signature = struct(EVIDENCE, contracts[EVIDENCE], "getEncryptionIdentity", [actors[step.role]]);
      return [evidence.identity(step.role), read(EVIDENCE, "currentTreeSize() view returns(uint64)", [], 0),
        tuple(signature, ["version"], [1])];
    }
    if (name === "purchase") {
      const id = await manager.policyCounter();
      assert.equal(id, BigInt(purchaseNames.indexOf(action) + 1));
      policies.set(action, id);
      const offer = await economics.getPackageIssueHash(1);
      const counter = (value) => read(MANAGER, "policyCounter() view returns(uint256)", [], value);
      return [[1, offer, ethers.id("paired:issued-policy:" + action)], counter(id), counter(id + 1n)];
    }
    if (name === "premium") {
      const quote = await installment();
      const before = policyPayments(quote.id, quote.paid);
      const after = policyPayments(quote.id, quote.paid + 1n);
      if (action === "wallet") return [[quote.id, quote.transferInstallment], before, after];
      const authorization = bankAuthorization[action === "otp-settle" ? "otp" : "mandate"];
      assert(authorization?.status === "authorized" && authorization.id === quote.id &&
        authorization.transferInstallment === quote.transferInstallment, "Bank fixture must authorize this exact installment");
      const reference = ethers.id("paired:bank:" + action);
      assert.equal(await bank.processedTransferReferences(reference), false);
      return [[quote.id, holder, quote.transferInstallment, reference,
        action === "eft-settle" ? ethers.id("paired:approved-mandate") : ethers.ZeroHash], before, after];
    }
    if (name !== "refund") throw new Error("Unknown setup/payment step " + step.id);
    const policyId = policies.get("refund");
    const claimable = (value) => read(BENEFITS, "claimableBenefitWei(address) view returns(uint256)", [holder], value);
    if (action === "accept") {
      const accepted = (value) => read(BENEFITS, "acceptedTermsVersionByPolicy(uint256) view returns(uint32)", [policyId], value);
      return [[policyId], accepted(0), accepted(1)];
    }
    if (action === "cancel") {
      const status = (value) => read(MANAGER, "getEffectivePolicyStatus(uint256) view returns(uint8)", [policyId], value);
      return [[policyId], status(1), status(4)];
    }
    if (action === "request") {
      refundId = await benefits.requestCounter();
      const expected = 2n * premium;
      assert.equal(await benefits.calculateBenefit(policyId, 1), expected);
      return [[policyId, 1, ethers.ZeroHash], claimable(0), benefitStatus(refundId, 1)];
    }
    if (action === "approve") return [[refundId], benefitStatus(refundId, 1), benefitStatus(refundId, 2)];
    if (action === "allocate") return [[refundId], benefitStatus(refundId, 2), benefitStatus(refundId, 4)];
    if (action === "withdraw") return [[], claimable(2n * premium), claimable(0)];
    throw new Error("Unbound refund step " + step.id);
  }

  async function claimsWorkflow(step, name, action) {
    const base = name === "appeal" ? "rejected" : name === "clarification-corrected" ? "clarification" : name;
    const spec = profile(name);
    const claimId = claims.get(base);
    const corrected = name === "appeal" || name === "clarification-corrected" || action === "corrected-publish";
    if (action.endsWith("publish")) {
      const episode = episodes.get(base);
      const record = corrected ? { ...episode.row, expectedBillMin: spec.grossEth, expectedBillMax: spec.grossEth } : episode.row;
      const records = [record];
      const root = registryRoot(records);
      const next = (await coordinator.currentRegistryVersion()) + 1n;
      archives.set(next.toString(), records);
      const version = (value) => read(ORACLE, "currentRegistryVersion() view returns(uint64)", [], value);
      return [[root, records.length, ethers.id("canonical-registry-schema-v1")], version(next - 1n), version(next)];
    }
    if (action === "claim") {
      const episode = episodes.get(base);
      const document = documents.get(base);
      const id = await manager.claimCounter();
      claims.set(base, id);
      const counter = read(MANAGER, "claimCounter() view returns(uint256)", [], id);
      return [[policies.get(base), amount(spec.grossEth, name), episode.incident, spec.service, episode.row.hospitalId,
        episode.row.invoiceHash, document.hash, document.cid], counter, claimStatus(id, 1)];
    }
    if (action === "oracle-request") {
      const requestId = await coordinator.requestCounter();
      requests.set(name, { requestId });
      return [[claimId], requestCount(requestId), requestCount(requestId + 1n)];
    }
    if (/^(commit|reveal)-[12]$/.test(action)) {
      const entry = requests.get(name);
      const request = await coordinator.getRequest(entry.requestId);
      if (!entry.outputs) entry.outputs = await evaluate({ request, records: archives.get(String(request.registryVersion)), expected: spec });
      const proof = entry.outputs[step.role];
      const worker = actors[step.role];
      const proofFacts = ethers.id(JSON.stringify([request.requestId.toString(), request.claimVersion.toString(), request.registryVersion.toString(),
        request.registryRoot, request.modelVersion, spec.route, proof.scoreUnits]));
      const meta = { requestId: entry.requestId, proofFacts };
      if (action.startsWith("commit")) {
        const check = (value) => read(ORACLE, "commitments(uint256,address) view returns(bytes32)", [entry.requestId, worker], value);
        return [[entry.requestId, proof.commitment], check(ethers.ZeroHash), check(proof.commitment),
          { ...meta, substitutions: [[proof.commitment, "$oracle.commitment:" + proofFacts]] }];
      }
      const check = (value) => read(ORACLE, "hasRevealed(uint256,address) view returns(bool)", [entry.requestId, worker], value);
      return [proof.reveal, check(false), action === "reveal-2" ? claimStatus(claimId, spec.route === "AUTO" ? 7 : 5) : check(true),
        { ...meta, substitutions: [[proof.reveal[2], "$oracle.result:" + proofFacts]] }];
    }
    if (action === "route") return [[claimId], claimStatus(claimId, 5), claimStatus(claimId, 6)];
    if (action === "review-open") {
      const proof = grants.get(base);
      const activation = (value) => tuple(struct(PANEL, panel, "getPreparation", [claimId, 1]), ["grantCommitment"], [value]);
      return [[claimId, 1, proof.evidenceSetHash, proof.grantCommitment], activation(ethers.ZeroHash), activation(proof.grantCommitment)];
    }
    if (action.startsWith("vote-")) {
      const kind = base === "manual" ? 1 : 2;
      const vote = (value) => read(PANEL, "getVote(uint256,uint64,address) view returns(uint8)", [claimId, 1, actors[step.role]], value);
      const decisive = action === (kind === 1 ? "vote-3" : "vote-2");
      return [[claimId, 1, kind, ethers.id("paired:review:" + base + ":" + action)], vote(0),
        decisive ? claimStatus(claimId, kind === 1 ? 7 : 8) : vote(kind)];
    }
    if (step.id === "appeal.submit") {
      const doc = documents.get("appeal");
      return [[claimId, ethers.id("paired:appeal:corrected-expected-bill"), doc.hash, doc.cid], claimStatus(claimId, 8), claimStatus(claimId, 12)];
    }
    if (step.id === "clarification.answer") {
      const gross = amount(spec.grossEth, name);
      const doc = documents.get("clarification-corrected");
      const signature = await clarificationAuthorization({ signer: signers.admin, chainId, panel: panel.target, holder, ...clarification,
        amount: gross, evidence: doc.hash });
      return [[claimId, clarification.version, clarification.deadline, gross, doc.hash, signature], versionOf(claimId, 1), versionOf(claimId, 2),
        { substitutions: [[signature, "$clarification.signature"]] }];
    }
    if (action === "withdraw") return [[claimId], claimStatus(claimId, 7), claimStatus(claimId, 9)];
    throw new Error("Unbound claim step " + step.id);
  }

  try {
    for (const [index, step] of manifest.operations.entries()) {
      if (step.category === "bootstrap" || /^setup\.(oracle[12]|auditor[1-4]|bank|medical-reserve)$/.test(step.id)) continue;
      const [name, action] = step.id.split(".");
      if (step.kind === "observation") {
        recordObservation(step, await observe(step, name, action));
        continue;
      }
      const [args, precondition, assertion, metadata = {}] = await (
        ["setup", "purchase", "premium", "refund"].includes(name) ? spendOrSetup(step, name, action) : claimsWorkflow(step, name, action)
      );
      const detail = { args, assertion, precondition, gasLimit: "2200000", requestId: metadata.requestId };
      const item = materialize({ ...manifest, operations: [step] }, deployment, { actors, transactions: { [step.id]: detail } }).get(step.id);
      const substitutions = new Map([...substitution, ...(metadata.substitutions ?? [])]);
      item.fingerprint = operationFingerprint({ step, args, before: precondition, after: assertion,
        previousOperation: manifest.operations[index - 1].id, substitutions });
      await provider.send("evm_setNextBlockTimestamp", [Number(logicalTime)]);
      logicalTime += 1n;
      const deliberatelyInterrupted = !interrupt && step.id === "routine.commit-1";
      if (deliberatelyInterrupted) {
        const nonce = await provider.getTransactionCount(item.from);
        await assert.rejects(executeIntent({ provider, item, journal: ledger, settings, signer: signers[step.role],
          reviewedFees: caps, interrupt: step.id }), /Rehearsal interrupted after broadcast/);
        ledger.close();
        ledger = openJournal(ledgerDirectory, ledgerIdentity);
        interrupt = { operationId: step.id, before: nonce };
      }
      const { canonical, observation, started } = await executeIntent({ provider, item, journal: ledger, settings,
        signer: signers[step.role], reviewedFees: caps });
      if (deliberatelyInterrupted) {
        interrupt.after = await provider.getTransactionCount(item.from);
        assert.equal(interrupt.after, interrupt.before + 1);
      }
      if (started !== undefined) {
        const finalized = await provider.getBlock("finalized");
        if (finalized && finalized.number >= Number(canonical.block.number)) observation.finalityMs = Math.round(performance.now() - started);
      }
      const attachedRequest = metadata.requestId ?? requests.get(name)?.requestId;
      let request;
      if (attachedRequest) {
        const pinned = await coordinator.getRequest(attachedRequest);
        request = { requestId: String(pinned.requestId), modelIdentity: pinned.modelVersion,
          registryVersion: String(pinned.registryVersion), registryRoot: pinned.registryRoot };
      }
      const row = rowFor({ item, canonical, observation, settings, request });
      assert.equal(row.status, "confirmed", step.id);
      if (step.id === "premium.otp-settle") bankAuthorization.otp.status = "settled";
      if (step.id === "premium.eft-settle") bankAuthorization.mandate.status = "settled";
      if (action === "withdraw") {
        const actual = row.transfers.find((transfer) => ["payout", "refund"].includes(transfer.kind));
        const expected = name === "refund" ? 2n * premium : amount(profile(name === "clarification" || name === "rejected" ? "manual" : name).payoutEth, name);
        assert.equal(BigInt(actual?.valueWei ?? 0), expected, step.id);
      }
      rows.push(row);
      console.log("Local", chainId, step.id);
    }
    assert.equal(await receiptsAtHead(), manifest.expectedTransactionsPerChain, "Every mined transaction must appear in the manifest");
    assert(interrupt && interrupt.after === interrupt.before + 1, "The recovery probe must reconcile exactly one send");
    assert.equal(observations.length, manifest.operations.filter((step) => step.kind === "observation").length);
    return { rows, observations, interrupt, clockAdvances };
  } finally { ledger.close(); }
}

module.exports = { localAdapter };

