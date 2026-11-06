// Metadata recovery with actual MongoDB; contract/notifications are explicit local doubles.
const test=require('node:test'),assert=require('node:assert/strict'),mongoose=require('mongoose'),{ethers}=require('ethers');
const load=require('./helpers/loadIsolatedModule');
const Attempt=require('../models/ClaimSubmissionAttempt'),File=require('../models/File'),Bundle=require('../models/EvidenceBundle'),Event=require('../models/EvidenceEvent');
let scope='31337:synthetic-claim4-recovery',database;
test.before(async()=>{const uri=new URL(process.env.E2E_MONGODB_URI||'');assert.ok(['127.0.0.1','localhost'].includes(uri.hostname));database='block_insure_claim_recovery_'+Date.now()+'_e2e';uri.pathname='/'+database;await mongoose.connect(uri.toString());await Promise.all([Attempt,File,Bundle,Event].map(m=>m.init()));});
test.after(async()=>mongoose.disconnect());
test('settled sponsored claim recovers its original file after lost API acknowledgment and repeated/concurrent retries',async()=>{
 const owner='0x'+'2'.repeat(40),target='0x'+'1'.repeat(40),iface=new ethers.Interface(require('../abi/InsuranceManager.json').abi),txHash=ethers.id('original-settled-claim4');
 const attempt=await Attempt.create({deploymentScope:scope,walletAddress:owner,policyId:'3',status:'TX_SUBMITTED',transactionHash:txHash,expiresAt:null,expectedEvidenceCount:1,submittedFacts:{incidentDate:'1',claimAmountWei:'20000',claimType:'HOSPITALIZATION',hospitalId:'HOSP-001',invoiceHash:ethers.id('original-invoice')}});
 const file=await File.create({deploymentScope:scope,attemptId:String(attempt._id),uploadSlot:0,uploaderWallet:owner,originalName:'synthetic-original.enc',mimeType:'application/octet-stream',sha256Hash:'b'.repeat(64),ipfsCID:'original-encrypted-cid',documentType:'HOSPITAL_BILL',claimVersion:1,envelopeClaimId:'attempt:'+attempt._id,keyCapsule:'unchanged-synthetic-capsule',encryptionIdentityVersion:1});
 attempt.documentId=String(file._id);attempt.documentIds=[String(file._id)];await attempt.save();
 const claim={claimId:4n,policyId:3n,claimantWallet:owner,incidentDate:1n,claimAmount:20000n,claimType:'HOSPITALIZATION',hospitalId:'HOSP-001',invoiceHash:attempt.submittedFacts.invoiceHash,documentHash:'0x'+file.sha256Hash,documentCID:file.ipfsCID,status:9n};
 const contract={target,interface:iface,getAddress:async()=>target,getClaim:async()=>claim,runner:{getTransactionReceipt:async()=>({status:1,logs:[{address:target,...iface.encodeEventLog(iface.getEvent('ClaimSubmitted'),[4n,3n,owner,20000n])}]})}};
 const bundles=load('services/evidenceBundleService.js',{'./deploymentScopeService':{getDeploymentScope:async()=>scope}});
 const dependencies={'../services/contractService':{getReadOnlyContract:()=>contract},'../services/evidenceBundleService':bundles,'../services/notificationService':{notifyAdmins:async()=>{}}};
 const req={params:{attemptId:String(attempt._id)},user:{walletAddress:owner,role:'USER'}};
 async function run(control,user=req.user){let error,body;await control.reconcileClaimSubmission({...req,user},{status(){return this;},json(v){body=v;return this;}},e=>error=e);return {error,body};}
 const lost=load('controllers/claimController.js',{...dependencies,'../models/ClaimSubmissionAttempt':{findOne:async()=>{const row=await Attempt.findById(attempt._id);row.save=async()=>{throw Error('synthetic API acknowledgment loss after evidence seal');};return row;}}});
 assert.match((await run(lost)).error.message,/acknowledgment loss/);
 assert.equal((await Attempt.findById(attempt._id)).status,'TX_SUBMITTED');
 const resumed=load('controllers/claimController.js',dependencies);
 for(const result of await Promise.all([run(resumed),run(resumed),run(resumed)])){assert.equal(result.error,undefined);assert.equal(result.body.claimId,'4');}
 const saved=await Attempt.findById(attempt._id);assert.equal(saved.status,'COMPLETED');assert.equal(saved.transactionHash,txHash);assert.equal(saved.claimId,'4');
 const restored=await File.findById(file._id).select('+keyCapsule');assert.equal(restored.keyCapsule,'unchanged-synthetic-capsule');assert.equal(restored.ipfsCID,file.ipfsCID);assert.equal(restored.sha256Hash,file.sha256Hash);
 assert.equal(await File.countDocuments({claimId:'4'}),1);assert.equal(await Bundle.countDocuments({claimId:'4',claimVersion:1}),1);assert.equal(await Event.countDocuments({claimId:'4'}),2);
 assert.ok((await run(resumed,{walletAddress:'0x'+'3'.repeat(40),role:'USER'})).error);
 await File.updateOne({_id:file._id},{$set:{claimVersion:2}});
 assert.ok((await run(resumed)).error);assert.equal(await Event.countDocuments({claimId:'4'}),2);
});
