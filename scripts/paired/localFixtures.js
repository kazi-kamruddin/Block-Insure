const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { ethers } = require("../../backEnd/node_modules/ethers");
const { Api256 } = require("../../backEnd/node_modules/@ironcorelabs/recrypt-node-binding");
const { getCanonicalRecordPayload } = require("../../backEnd/services/merkleRegistryService");
const { loadAdvisoryBundle } = require("../../oracle/advisoryBundle");
const { binding, hash, registryRoot } = require("../../oracle/shadowAssessment");
const { hashCanonicalRecord } = require("../../oracle/merkleProof");
const { assessProtocol } = require("../../oracle/protocolAssessment");
const { buildCommitment, buildResultHash, buildSalt } = require("../../oracle/protocol");

const SCHEME = ethers.sha256(ethers.toUtf8Bytes("RECRYPT-RS-0.15+A256GCM"));
const encode = ethers.AbiCoder.defaultAbiCoder();

function createEvidenceFixtures(roles, checkpoint) {
  const api = new Api256();
  let identityState = checkpoint?.read("evidence-identities");
  if (!identityState) {
    identityState = { identities: Object.fromEntries(roles.map((role) => [role, {
      pair: api.generateKeyPair(), signing: api.generateEd25519KeyPair(),
    }])), proxy: api.generateEd25519KeyPair() };
    checkpoint?.create("evidence-identities", identityState);
  }
  const { identities, proxy } = identityState;
  const documents = new Map();
  const owner = identities.holder;
  return {
    identity(role) {
      const { pair, signing } = identities[role];
      return [ethers.hexlify(Buffer.concat([pair.publicKey.x, pair.publicKey.y])),
        ethers.hexlify(signing.publicKey), SCHEME];
    },
    seal(name, facts) {
      if (documents.has(name)) return documents.get(name).public;
      const plaintext = Buffer.from(JSON.stringify({ synthetic: true, case: name, ...facts }));
      const saved = checkpoint?.read("evidence-" + name);
      if (saved) {
        assert.deepEqual(saved.plaintext, plaintext, "Evidence recovery requires identical reviewed facts");
        documents.set(name, saved);
        return saved.public;
      }
      const material = api.generatePlaintext();
      const key = api.deriveSymmetricKey(material);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      const content = Buffer.concat([iv, tag, ciphertext]);
      const address = crypto.createHash("sha256").update(content).digest("hex");
      const capsule = api.encrypt(material, owner.pair.publicKey, owner.signing.privateKey);
      const publicDocument = { hash: "0x" + address, cid: "local-fixture://" + address, encryptedBytes: content.length };
      const document = { public: publicDocument, iv, tag, ciphertext, capsule, plaintext };
      checkpoint?.create("evidence-" + name, document);
      documents.set(name, document);
      return publicDocument;
    },
    prepare(name) {
      const document = documents.get(name) ?? checkpoint?.read("evidence-" + name);
      const grants = Object.entries(identities).filter(([role]) => /^auditor/.test(role)).map(([role, auditor]) => {
        const key = api.generateTransformKey(owner.pair.privateKey, auditor.pair.publicKey, owner.signing.privateKey);
        const transformed = api.transform(document.capsule, key, proxy.privateKey);
        const material = api.decrypt(transformed, auditor.pair.privateKey);
        const decipher = crypto.createDecipheriv("aes-256-gcm", api.deriveSymmetricKey(material), document.iv);
        decipher.setAuthTag(document.tag);
        assert.deepEqual(Buffer.concat([decipher.update(document.ciphertext), decipher.final()]), document.plaintext);
        return hash({ role, document: document.public.hash });
      });
      assert.equal(grants.length, 4);
      return { readers: grants.length, evidenceSetHash: document.public.hash, grantCommitment: "0x" + hash(grants) };
    },
  };
}

function buildEpisode({ name, profile, expected, holder, incident, registryReference = incident }) {
  const date = new Date(Number(registryReference) * 1000).toISOString().slice(0, 10) + "T00:00:00.000Z";
  return getCanonicalRecordPayload({
    hospitalId: "HOSP-001", hospitalName: "Paired rehearsal hospital", patientHash: ethers.id("paired:patient:" + name),
    authorizedClaimants: [holder], admissionDate: date, dischargeDate: date, invoiceDate: date,
    billAmount: profile.grossEth, expectedBillMin: expected, expectedBillMax: expected,
    invoiceHash: ethers.id("paired:invoice:" + name), invoiceNumber: "paired-" + name,
    treatmentType: profile.service, diagnosisCode: "D1", licenseStatus: "ACTIVE", recordStatus: "VALID", invoiceStatus: "VALID",
  });
}

function createOracleFixtures({ provider, coordinator, manager, chainId, signers }) {
  const loaded = loadAdvisoryBundle();
  return async function evaluate({ request, records, expected }) {
    const [claim, snapshot, block] = await Promise.all([manager.getClaim(request.claimId),
      coordinator.getRegistrySnapshot(request.registryVersion), provider.getBlock(Number(request.requestBlock))]);
    assert.equal(registryRoot(records), request.registryRoot, "The archive must match the request-pinned root");
    const authoritative = { request, claim: { ...claim.toObject(), claimAmountEth: ethers.formatEther(claim.claimAmount) },
      chainId, managerAddress: manager.target, coordinatorAddress: coordinator.target, snapshotTimestamp: snapshot.publishedAt,
      requestBlockHash: block.hash };
    const pinned = binding({ ...authoritative, bundleHash: loaded.bundleHash, manifestHash: loaded.manifestHash });
    const record = records.find((value) => value.invoiceHash === claim.invoiceHash);
    const result = {};
    for (const role of ["oracle1", "oracle2"]) {
      const input = { version: "request-shadow-v1", binding: pinned, contextId: hash(pinned), records: structuredClone(records) };
      const decision = assessProtocol(input, authoritative, loaded);
      assert.equal(decision.verified, expected.route === "AUTO", "The frozen evaluator selected an unexpected route");
      assert.equal(decision.assessment.result.scoreUnits, expected.scoreUnits);
      assert.equal(decision.assessment.result.oodWarning, expected.oodWarning);
      const resultHash = buildResultHash({ request, verified: decision.verified, verificationCode: decision.verificationCode,
        leafHash: hashCanonicalRecord(record) });
      const oracleAddress = signers[role].address;
      const salt = buildSalt({ requestId: request.requestId, oracleAddress, privateKey: signers[role].privateKey });
      result[role] = {
        commitment: buildCommitment(request, decision.verified, resultHash, salt, { chainId,
          oracleAddress, coordinatorAddress: coordinator.target }),
        reveal: [request.requestId, decision.verified, resultHash, request.claimVersion, request.registryVersion, request.modelVersion, salt],
        scoreUnits: decision.assessment.result.scoreUnits,
      };
    }
    assert.equal(result.oracle1.reveal[2], result.oracle2.reveal[2], "The two exact-result workers must agree");
    return result;
  };
}

async function clarificationAuthorization({ signer, chainId, panel, holder, claimId, version, deadline, amount, evidence }) {
  const digest = ethers.keccak256(encode.encode(
    ["uint256", "address", "address", "uint256", "uint64", "uint64", "uint256", "bytes32"],
    [chainId, panel, holder, claimId, version, deadline, amount, evidence]));
  return signer.signMessage(ethers.getBytes(digest));
}

module.exports = { buildEpisode, createEvidenceFixtures, createOracleFixtures, clarificationAuthorization };

