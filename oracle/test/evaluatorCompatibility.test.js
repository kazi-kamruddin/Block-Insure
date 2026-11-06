const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const { ethers } = require('ethers');
const fixture = require('../../backEnd/test/helpers/shadowFixture');
const { buildMerkleTree, getCanonicalRecordPayload } = require('../../backEnd/services/merkleRegistryService');
const { assessProtocol, unavailable } = require('../protocolAssessment');
const { hash, binding } = require('../shadowAssessment');
const { verifyRegistryProof } = require('../merkleProof');
const { invoiceIdentity } = require('../recordIdentity');
const { independentlyAssessRecord } = require('../independentAssessment');
const protocol = require('../protocol'), { requestDisposition } = require('../scanRecovery');
const runtime = require('../runtimeProtocol');
const original = fs.readFileSync(require.resolve('./fixtures/protocol-v4-index.txt'), 'utf8');
const patched = fs.readFileSync(require.resolve('../index'), 'utf8');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const plain = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v));
test('archived source matches frozen hash; decision-bearing source sections are unchanged', () => {
 const frozen = runtime.loadProtocolArtifact();
 assert.equal(crypto.createHash('sha256').update(original).digest('hex'), frozen.sourceHashes['oracle/index.js']);
 assert.equal(section(original, 'const validateAppealCommitment =', 'const waitForRevealPhase ='), section(patched, 'const validateAppealCommitment =', 'const waitForRevealPhase ='));
 assert.equal(section(original, '    const selectedModel =', '    if (existingCommitment ==='), section(patched, '    const selectedModel =', '    const beforeSend ='));
});
async function run(source, f, scenario, instance) {
 const profile = runtime.loadProtocolArtifact();
 const request = { ...f.authoritative.request, modelVersion: profile.modelIdentityHash, queryHash: ethers.id('query'), commitDeadlineBlock: 100, revealDeadlineBlock: 200, expectedResponses: 2, isFulfilled: false };
 if(scenario === 'invalid-appeal' || scenario === 'valid-appeal') request.claimVersion = '2';
 const claim = { ...f.authoritative.claim, claimId: 1n, policyId: 1n, claimAmount: ethers.parseEther(f.authoritative.claim.claimAmountEth), toObject() { return { ...f.authoritative.claim, claimAmount: this.claimAmount }; } };
 const bound = binding({ ...f.authoritative, request, bundleHash: f.loaded.bundleHash, manifestHash: f.loaded.manifestHash });
 const packet = { ...f.packet, binding: bound, contextId: hash(bound) };
 const record = getCanonicalRecordPayload(f.record), tree = buildMerkleTree([f.record]);
 const proof = { found: true, rootHash: tree.rootHash, canonicalRecord: record, leafHash: require('../merkleProof').hashCanonicalRecord(record), proof: [] };
 const hospital = { registrySnapshot: instance === '1' ? 'primary' : 'oracle2', contractedHospital: true, merkleProof: proof };
 if(scenario === 'invalid-proof') hospital.merkleProof = null;
 let appealHash;
 if(scenario === 'valid-appeal') {
  const payload={schema:'BLOCK_INSURE_APPEAL_V1',claimId:'1',proposedClaimAmountEth:f.authoritative.claim.claimAmountEth,proposedHospitalId:claim.hospitalId,proposedClaimType:claim.claimType};
  appealHash='0x'+crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  hospital.appealCommitment={payload,appealReasonHash:appealHash,transactionHash:'synthetic-appeal'};
  hospital.query={source:'PENDING_APPEAL_CORRECTION',claimId:'1',invoiceHash:claim.invoiceHash,hospitalId:claim.hospitalId,claimType:claim.claimType,claimAmountEth:f.authoritative.claim.claimAmountEth};
 }
 const captures = {};
 const coordinator = { getRequest: async () => request, hasRevealed: async () => false, eligibleForRequest: async () => true,
  commitments: async () => ethers.ZeroHash, getRegistrySnapshot: async () => ({publishedAt:f.authoritative.snapshotTimestamp}), commitmentCount: async () => 2,
  commitOracleResult: async (id, commitment) => {captures.commitment = commitment;return {hash:'commit', wait:async()=>{}};},
  revealOracleResult: async (...args) => {captures.reveal=plain(args);return {hash:'reveal',wait:async()=>{}};} };
 const backendHttp = { get: async () => ({data:hospital}), post: async (url, body) => {
  if(url.endsWith('/decision/read')) return {data:{data:{assessment:null}}};
  if(url.endsWith('/shadow/context')) {if(scenario==='unavailable') throw Error('test context outage');return {data:{data:packet}};}
  if(url.endsWith('/decision/save')) {captures.assessment=plain(body.assessment);return {data:{data:{assessment:body.assessment}}};}
  throw Error('unexpected endpoint');
 }};
 const c = { Date, crypto, ethers, stopping:false, processingRequests:new Set(), coordinator, coordinatorAddress:f.authoritative.coordinatorAddress,
  oracleWallet:{address:instance==='1'?ethers.ZeroAddress:'0x'+'1'.repeat(40),signMessage:async()=> 'test-only-signature'},
  provider:{getBlockNumber:async()=>50,getNetwork:async()=>({chainId:31337n}),getBlock:async()=>({hash:f.authoritative.requestBlockHash}),getTransactionReceipt:async()=>({status:1,logs:[{address:f.authoritative.managerAddress}]}),getTransaction:async()=>({from:claim.claimantWallet,to:f.authoritative.managerAddress})},
  manager:{getClaim:async()=>claim,interface:{parseLog:()=>({name:'ClaimAppealed',args:{claimId:1n,appealReasonHash:appealHash}})}},ORACLE_INSTANCE_ID:instance,ORACLE_PRIVATE_KEY:'0x'+'2'.repeat(64),ORACLE_API_KEY:'test',ORACLE_POLL_INTERVAL_MS:10,
  ORACLE_REGISTRY_SNAPSHOT:instance==='1'?'primary':'oracle2',CONTRACT_ADDRESS:f.authoritative.managerAddress,BACKEND_API_URL:'http://local.test',MOCK_HOSPITAL_API_URL:'http://local.test/verify',
  simulatedNetworkDelayMs:0,sleep:async()=>{},backendHttp,resolveRequestModel:runtime.resolveRequestModel,runtimeModelArtifact:require('../../backEnd/model-params.json'),activeProtocol:profile,
  triagePolicy:require('../../backEnd/triage-policy.json'),verifyRegistryProof,invoiceIdentity,independentlyAssessRecord,normalizeHash:v=>String(v||'').toLowerCase(),
  assessProtocol,unavailableProtocol:unavailable,shadowFacts:require('../shadowAssessment').facts,shadowHash:hash,signedMessage:require('../shadowAssessment').signedMessage,
  ...protocol,requestDisposition,retryTransaction:async(_,fn)=>fn(),saveOracleLog:async()=>{},sendHeartbeat:async()=>{},console:{log:()=>{},warn:()=>{}} };
 vm.createContext(c);
 const helpers=section(source,'const validateAppealCommitment =','const handleOracleRequested =');
 const handler=section(source,'const handleOracleRequested =',source===original?'const pollOracleRequests =':'const positiveConfig =');
 vm.runInContext(helpers+handler+'\nthis.handle=handleOracleRequested;',c);
 await c.handle(1n,1n);return captures;
}
for(const instance of ['1','2'])for(const scenario of ['automatic','review','invalid-proof','unavailable','invalid-appeal','valid-appeal']) {
 test(`old/patched exact assessment, result and commitment parity: Oracle ${instance}, ${scenario}`,async()=>{
  const f=fixture();
  if(scenario==='review') { f.record.billAmount='1000000'; f.authoritative.claim.claimAmountEth='1000000.0';f.authoritative.request.registryRoot=buildMerkleTree([f.record]).rootHash;f.packet.records=[getCanonicalRecordPayload(f.record)]; }
  const old=await run(original,f,scenario,instance), current=await run(patched,f,scenario,instance);
  assert.deepEqual(current,old);assert.ok(current.commitment);assert.ok(current.reveal);
  if(scenario==='automatic'||scenario==='valid-appeal') assert.equal(current.assessment.verified,true);
  if(scenario==='review') assert.match(current.assessment.verificationCode,/^XGB_REVIEW:/);
  if(scenario==='invalid-proof') assert.equal(current.assessment.verificationCode,'INVALID_MERKLE_PROOF');
  if(scenario==='unavailable') assert.equal(current.assessment.verificationCode,'XGB_CONTEXT_OR_INFERENCE_UNAVAILABLE');
  if(scenario==='invalid-appeal') assert.equal(current.assessment.verificationCode,'APPEAL_COMMITMENT_MISMATCH');
 });
}


