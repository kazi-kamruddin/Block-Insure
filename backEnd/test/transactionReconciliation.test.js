const test=require('node:test'),assert=require('node:assert/strict');
const {ethers}=require('ethers');const load=require('./helpers/loadIsolatedModule');
const manager='0x'+'1'.repeat(40),owner='0x'+'2'.repeat(40),other='0x'+'3'.repeat(40),hash='0x'+'a'.repeat(64);
const iface=new ethers.Interface(require('../abi/InsuranceManager.json').abi);
const claim={claimId:4n,policyId:3n,claimantWallet:owner,claimAmount:20000n,incidentDate:1n,claimType:'HOSPITALIZATION',hospitalId:'HOSP-001',invoiceHash:ethers.id('invoice'),documentHash:ethers.id('document'),documentCID:'cid',status:7n,verificationConfidence:100n,submittedAt:1n};
const event=(name,args,address=manager)=>({address,...iface.encodeEventLog(iface.getEvent(name),args),blockNumber:50,index:0});
function fixture(kind='admin'){
 const method=kind==='admin'?'requestOracleVerification':'payPremium';const id=kind==='admin'?4n:3n;
 const transaction={from:other,to:other,data:'0x',hash};
 const receipt={status:1,blockNumber:50,logs:[kind==='admin'?event('OracleRequested',[1n,4n,'HOSPITAL']):event('PremiumPaid',[3n,owner,10000n,1n,2n,2n,20000n])]};
 const provider={getTransactionReceipt:async()=>receipt,getTransaction:async()=>transaction,send:async()=>({type:'CALL',from:other,to:other,calls:[{type:'CALL',from:owner,to:manager,input:iface.encodeFunctionData(method,[id])}]})};
 const contract={target:manager,interface:iface,runner:provider,getClaim:async()=>claim,getPolicy:async()=>({holderWallet:owner,packageId:1n}),getPolicyPackage:async()=>({name:'Health',policyType:'HEALTH'})};
 return {method,id,transaction,receipt,provider,contract};
}
async function admin(f,previous=null){let error,body,logged;
 const control=load('controllers/adminController.js',{'../models/AdminActionLog':{findOne:()=>({lean:async()=>previous})},'../services/contractService':{getReadOnlyContract:()=>f.contract},'../services/notificationService':{notifyClaimStatusChange:async()=>{}},'../services/adminActionLogService':{logAdminAction:async args=>{logged=args;}}});
 await control.confirmAdminClaimTransaction({params:{id:'4'},body:{action:f.action||'REQUEST_ORACLE_VERIFICATION',transactionHash:hash},user:{walletAddress:owner,role:'ADMIN'}},{status(){return this;},json(v){body=v;return this;}},e=>error=e);return {error,body,logged};
}
async function payment(f){let error,body;const control=load('controllers/paymentController.js',{'../services/contractService':{getReadOnlyContract:()=>f.contract,getContractAddress:()=>manager},'../services/notificationService':{notifyWallet:async()=>{}},'../services/paymentStatementService':{formatPremiumEvent:()=>({policyId:'3',amountEth:'0.01',purpose:'RECURRING_PREMIUM'})}});
 await control.confirmPremiumPayment({body:{transactionHash:hash},user:{walletAddress:owner}},{status(){return this;},json(v){body=v;return this;}},e=>error=e);return {error,body};}
test('Admin sponsored confirmation proves the authenticated internal actor',async()=>{const r=await admin(fixture());assert.equal(r.error,undefined);assert.equal(r.body.onChainActor,owner);});
test('wallet premium sponsored confirmation binds trusted event payer and policy owner',async()=>{const r=await payment(fixture('payment'));assert.equal(r.error,undefined);assert.equal(r.body.success,true);});
module.exports={fixture,admin,payment,event,manager,owner,other,hash,iface};

for(const [name,change] of [
 ['wrong internal actor',f=>{f.provider.send=async()=>({type:'CALL',from:other,to:manager,input:iface.encodeFunctionData(f.method,[f.id])});}],
 ['wrong internal contract',f=>{f.provider.send=async()=>({type:'CALL',from:owner,to:other,input:iface.encodeFunctionData(f.method,[f.id])});}],
 ['wrong operation',f=>{f.provider.send=async()=>({type:'CALL',from:owner,to:manager,input:iface.encodeFunctionData('sendToManualReview',[f.id])});}],
 ['wrong claim',f=>{f.provider.send=async()=>({type:'CALL',from:owner,to:manager,input:iface.encodeFunctionData(f.method,[99])});}],
 ['forged emitter',f=>{f.receipt.logs[0].address=other;}],
 ['reverted inner subtree',f=>{f.provider.send=async()=>({type:'CALL',error:'revert',calls:[{type:'CALL',from:owner,to:manager,input:iface.encodeFunctionData(f.method,[f.id])}]});}],
 ['reverted receipt',f=>{f.receipt.status=0;}],
 ['unavailable traces',f=>{f.provider.send=async()=>{throw Error('not supported');};}],
 ['ambiguous calls',f=>{const call={type:'CALL',from:owner,to:manager,input:iface.encodeFunctionData(f.method,[f.id])};f.provider.send=async()=>({type:'CALL',calls:[call,call]});}],
])test('Admin rejects '+name,async()=>{const f=fixture();change(f);const r=await admin(f);assert.ok(r.error);assert.equal(r.logged,undefined);});
test('direct Admin confirmation still verifies method, claim and trusted event',async()=>{const f=fixture();f.transaction={from:owner,to:manager,data:iface.encodeFunctionData(f.method,[f.id])};assert.equal((await admin(f)).error,undefined);});
test('a previous confirmation cannot bypass wrong-actor proof',async()=>{const f=fixture();f.provider.send=async()=>({type:'CALL',from:other,to:manager,input:iface.encodeFunctionData(f.method,[4])});assert.ok((await admin(f,{actorWallet:owner,targetId:'4'})).error);});
test('a previous audit for another claim cannot confirm this claim',async()=>{const f=fixture();assert.ok((await admin(f,{actorWallet:owner,targetId:'9'})).error);});
for(const [name,change]of[
 ['wrong payer',f=>{f.receipt.logs=[event('PremiumPaid',[3n,other,10000n,1n,2n,2n,20000n])];}],
 ['wrong emitter',f=>{f.receipt.logs[0].address=other;}],
 ['wrong policy owner',f=>{f.contract.getPolicy=async()=>({holderWallet:other});}],
 ['ambiguous payments',f=>{f.receipt.logs.push(f.receipt.logs[0]);}],
 ['reverted payment',f=>{f.receipt.status=0;}],
])test('premium confirmation rejects '+name,async()=>{const f=fixture('payment');change(f);assert.ok((await payment(f)).error);});
test('direct premium still confirms',async()=>{const f=fixture('payment');f.transaction={from:owner,to:manager};assert.equal((await payment(f)).error,undefined);});

function appealFixture(){const f=fixture();const appealHash=ethers.id('reason');const adjudicator={target:other,interface:new ethers.Interface(require('../abi/ClaimAdjudicator.json').abi)};
 const appealEvent=adjudicator.interface.getEvent('AppealStarted');
 const args=appealEvent.inputs.map(input=>input.name==='claimId'?4n:input.name==='newClaimVersion'?2n:input.type==='address'?owner:1n);
 f.receipt.logs=[event('ClaimAppealed',[4n,owner,appealHash,1n]),{address:other,...adjudicator.interface.encodeEventLog(appealEvent,args)}];
 const control=load('controllers/appealController.js',{'../services/contractService':{getClaimAdjudicator:async()=>adjudicator}});
 return {...f,appealHash,verify:()=>control.verifyAppealTransaction(f.contract,'4',owner,hash,appealHash)};
}
test('sponsored appeal binds claimant, reason and version events',async()=>{const f=appealFixture();assert.equal((await f.verify()).claimVersion,2);});
for(const [name,change]of[
 ['wrong claimant',f=>{f.receipt.logs[0]=event('ClaimAppealed',[4n,other,f.appealHash,1n]);}],
 ['wrong reason',f=>{f.receipt.logs[0]=event('ClaimAppealed',[4n,owner,ethers.id('wrong'),1n]);}],
 ['forged emitter',f=>{f.receipt.logs[0].address=other;}],
 ['missing version event',f=>{f.receipt.logs.pop();}],
])test('appeal rejects '+name,async()=>{const f=appealFixture();change(f);await assert.rejects(f.verify());});
test('manual review uses its trusted actor event without a tracing dependency',async()=>{
 const f=fixture();f.action='SEND_CLAIM_TO_MANUAL_REVIEW';f.receipt.logs=[event('ClaimSentToManualReview',[4n,owner,1n])];f.provider.send=async()=>{throw Error('trace unavailable');};
 const r=await admin(f);assert.equal(r.error,undefined);assert.equal(r.logged.metadata.executionProof,'TRUSTED_ACTOR_EVENT');
});
test('manual review cannot attribute another event actor to this Admin',async()=>{const f=fixture();f.action='SEND_CLAIM_TO_MANUAL_REVIEW';f.receipt.logs=[event('ClaimSentToManualReview',[4n,other,1n])];assert.ok((await admin(f)).error);});
test('idempotent Admin confirmation rechecks proof without another audit write',async()=>{const r=await admin(fixture(),{actorWallet:owner,targetId:'4'});assert.equal(r.error,undefined);assert.equal(r.body.idempotent,true);assert.equal(r.logged,undefined);});
test('oversized trace fails bounded confirmation',async()=>{const f=fixture();f.provider.send=async()=>({calls:Array.from({length:2001},()=>({type:'CALL'}))});assert.ok((await admin(f)).error);});
test('malformed trace fails confirmation',async()=>{const f=fixture();f.provider.send=async()=>({calls:{bad:'shape'}});assert.ok((await admin(f)).error);});
