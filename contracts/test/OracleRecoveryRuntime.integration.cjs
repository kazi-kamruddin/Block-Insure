// Actual enabled workers + local Hardhat + signed API cursor/decision handlers + Mongo.
// Hospital response is deliberately invalid synthetic evidence; no provider emails/storage.
const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const hre = require('hardhat'), { ethers } = hre;
const express = require('../../backEnd/node_modules/express');
const mongoose = require('../../backEnd/node_modules/mongoose');
const { configureOracleFixture } = require('./helpers/oracleCoordinator');
const root = path.resolve(__dirname, '../..');
const profile = require('../../oracle/runtimeProtocol').loadProtocolArtifact();
const release = require('../../oracle/runtimeProtocol').loadOperationalRelease();
const delay = ms => new Promise(r => setTimeout(r, ms));
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(r => { server.closeAllConnections?.(); server.close(r); });
async function until(check, label, ms=45000) { const start=Date.now();while(Date.now()-start<ms){if(await check())return;await delay(150);}throw Error('Timed out: '+label); }
describe('Oracle operational compatibility and local restart recovery', function () {
 this.timeout(150000);
 it('restores signed cursors, recovers a mined commitment and scans past expired work with both enabled workers', async function () {
  assert.equal((await ethers.provider.getNetwork()).chainId,31337n);
  const database='block_insure_oracle_compat_'+Date.now()+'_e2e';
  const children=[], logs=[], servers=[];let rpcFault=false,loseCursorAck=true;
  const savedEnv={RPC_URL:process.env.RPC_URL,VITE_CONTRACT_ADDRESS:process.env.VITE_CONTRACT_ADDRESS,ORACLE_API_KEY:process.env.ORACLE_API_KEY};
  const started=Date.now();
  try {
   await mongoose.connect('mongodb://127.0.0.1:27039/'+database,{serverSelectionTimeoutMS:10000});
   const [admin,user,,one,two]=await ethers.getSigners();
   const manager=await (await ethers.getContractFactory('InsuranceManager')).deploy();await manager.waitForDeployment();
   const coordinator=await configureOracleFixture(manager,admin,[one,two],{commitBlocks:5,revealBlocks:5});
   await manager.updateOracleModelVersion(profile.modelIdentityHash);
   await manager.createPolicyPackage('Recovery fixture','HEALTH',ethers.parseEther('0.01'),ethers.parseEther('1'),365,'HOSPITAL_BILL');
   await manager.connect(user).purchasePolicy(1,{value:ethers.parseEther('0.01')});
   const incident=(await manager.getPolicy(1)).startDate;
   const makeClaim=async n=>{await manager.connect(user).submitClaim(1,ethers.parseEther('0.1'),incident+BigInt(n-1),'HOSPITALIZATION','HOSP-001',ethers.id('recover-'+n),ethers.id('doc-'+n),'ipfs://synthetic-'+n);await manager.requestOracleVerification(n);};
   await makeClaim(1);const first=await coordinator.getRequestByClaimId(1);
   await hre.network.provider.send('hardhat_mine',['0x1770']); // 6,000 local blocks, not real elapsed network time.
   await coordinator.updateConsensusConfig(2,5000,5000);await makeClaim(2);
   const request=await coordinator.getRequestByClaimId(2);
   const rpc=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;
    try{const input=JSON.parse(body);const call=async q=>{if(rpcFault)return {jsonrpc:'2.0',id:q.id,error:{code:-32005,message:'synthetic provider rate limit'}};
     try{return {jsonrpc:'2.0',id:q.id,result:await hre.network.provider.send(q.method,q.params||[])};}catch(e){return {jsonrpc:'2.0',id:q.id,error:{code:e.code||-32000,message:e.message}};}};
     const result=Array.isArray(input)?await Promise.all(input.map(call)):await call(input);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
    }catch{res.writeHead(500).end();}});servers.push(rpc);const rpcUrl=await listen(rpc);
   process.env.RPC_URL=rpcUrl;process.env.VITE_CONTRACT_ADDRESS=await manager.getAddress();process.env.ORACLE_API_KEY='local-recovery-test-only';
   const app=express();app.use(express.json());
   const auth=require('../../backEnd/middleware/oracleApiKeyMiddleware');
   const control=require('../../backEnd/controllers/oracleController');
   const decisions=require('../../backEnd/controllers/oracleDecisionController');
   app.get('/api/oracle/cursor',auth,control.getOracleCursor);
   app.put('/api/oracle/cursor',auth,(req,res,next)=>{
    // Save the real signed cursor, then simulate a lost acknowledgement once.
    if(!loseCursorAck)return control.saveOracleCursor(req,res,next);
    const original=res.json.bind(res);res.json=body=>{res.json=original;if(!body.success)return original(body);loseCursorAck=false;return res.status(503).json({success:false,message:'synthetic lost acknowledgment'});};
    return control.saveOracleCursor(req,res,next);
   });
   app.post('/api/oracle/protocol/decision/read',auth,decisions.readDecision);
   app.post('/api/oracle/protocol/decision/save',auth,decisions.saveDecision);
   app.post('/api/oracle/heartbeat',auth,control.recordOracleHeartbeat);
   app.post('/api/oracle/logs',auth,control.createOracleLog);
   app.get('/mock/hospital/verify',auth,(req,res)=>res.json({registrySnapshot:req.query.registrySnapshot,contractedHospital:true,merkleProof:null}));
   app.use((e,req,res,next)=>{logs.push('API failure '+req.path+' '+e.name+': '+e.message);res.status(e.statusCode||500).json({success:false,message:'local fixture failure'});});
   const api=http.createServer(app);servers.push(api);const apiUrl=await listen(api);
   // Exercise real API-key and recovered-signer boundaries, not an auth bypass.
   const cursorQuery=new URLSearchParams({oracleWallet:one.address,oracleInstanceId:'1',chainId:'31337',contractAddress:await coordinator.getAddress()});
   assert.equal((await fetch(apiUrl+'/api/oracle/cursor?'+cursorQuery)).status,401);
   const invalid={oracleWallet:one.address,oracleInstanceId:'1',chainId:'31337',contractAddress:await coordinator.getAddress(),nextBlock:1,timestamp:new Date().toISOString(),signature:await user.signMessage('wrong cursor')};
   assert.equal((await fetch(apiUrl+'/api/oracle/cursor',{method:'PUT',headers:{'Content-Type':'application/json','x-oracle-api-key':'local-recovery-test-only'},body:JSON.stringify(invalid)})).status,401);
   const mnemonic=require('hardhat/internal/core/config/default-config').HARDHAT_NETWORK_MNEMONIC;
   async function worker(instance){
    const wallet=ethers.HDNodeWallet.fromPhrase(mnemonic,undefined,`m/44'/60'/0'/0/${instance==='1'?3:4}`);assert.equal(wallet.address,instance==='1'?one.address:two.address);
    const reserve=http.createServer();const addr=await listen(reserve);const port=new URL(addr).port;await close(reserve);
    const child=spawn(process.execPath,['index.js'],{cwd:path.join(root,'oracle'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,
     ORACLE_ENV_FILE:path.join(root,'tmp','does-not-exist-recovery.env'),ORACLE_INSTANCE_ID:instance,ORACLE_PRIVATE_KEY:wallet.privateKey,
     ORACLE_WORKER_ENABLED:'true',RPC_URL:rpcUrl,CONTRACT_ADDRESS:await manager.getAddress(),BACKEND_API_URL:apiUrl,MOCK_HOSPITAL_API_URL:apiUrl+'/mock/hospital/verify',
     ORACLE_API_KEY:'local-recovery-test-only',ORACLE_CURSOR_MODE:'backend',ORACLE_START_BLOCK:'0',ORACLE_EVENT_QUERY_CHUNK_SIZE:'2000',
     ORACLE_POLL_INTERVAL_MS:'300',ORACLE_HTTP_TIMEOUT_MS:'3000',ORACLE_HEARTBEAT_INTERVAL_MS:'1000',ORACLE_SHADOW_ENABLED:'false',ORACLE2_SIMULATED_NETWORK_DELAY_MS:'0',PORT:port}});
    const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve);});
    child.stdout.on('data',c=>logs.push('worker '+instance+' '+c.toString()));child.stderr.on('data',c=>logs.push('worker '+instance+' '+c.toString()));
    const w={child,exited,url:addr};children.push(w);return w;
   }
   const a=await worker('1');
   await until(async()=>await coordinator.commitments(request.requestId,one.address)!==ethers.ZeroHash,'first worker commit');
   const decisionModel=require('../../backEnd/models/OracleProtocolDecision');
   const before=await decisionModel.findOne({requestId:String(request.requestId),oracleWallet:one.address.toLowerCase()}).lean();assert.ok(before);const pinned=JSON.stringify(before.assessment);
   a.child.kill();await a.exited;
   const durableBefore=await require('../../backEnd/models/OracleHealth').findOne({oracleInstanceId:'1'}).lean();assert.ok(durableBefore.nextBlock>0);
   const b=await worker('2'), restarted=await worker('1');
   await until(async()=>Boolean((await coordinator.getRequest(request.requestId)).isFulfilled),'both recovered reveals');
   assert.equal(await coordinator.commitmentCount(request.requestId),2n);assert.equal(await coordinator.revealCount(request.requestId),2n);
   assert.equal((await coordinator.getRequest(request.requestId)).verifiedResult,false);
   assert.equal((await coordinator.getRequest(first.requestId)).isFulfilled,false,'workers must not manufacture expired fulfillment');
   const after=await decisionModel.findById(before._id).lean();assert.equal(JSON.stringify(after.assessment),pinned);
   assert.equal(await decisionModel.countDocuments({requestId:String(request.requestId)}),2);
   const states=[];
   for(const w of [restarted,b]){
    await until(async()=>{try{return (await fetch(w.url+'/health/ready')).status===200;}catch{return false;}},'near-head worker readiness');
    const state=await (await fetch(w.url+'/health/ready')).json();assert.equal(state.protocolModel.identity,profile.modelIdentityHash);assert.equal(state.operationalRelease.runtimeIdentityHash,release.runtimeIdentityHash);assert.ok(state.scanLagBlocks<=150);states.push(state);
   }
   // A provider outage degrades readiness but leaves liveness; restoration recovers.
   rpcFault=true;
   await until(async()=>(await fetch(restarted.url+'/health/ready')).status===503,'provider outage readiness');
   assert.equal((await fetch(restarted.url+'/health/live')).status,200);rpcFault=false;
   await until(async()=>(await fetch(restarted.url+'/health/ready')).status===200,'provider recovery');
   await coordinator.resolveTimedOutRequest(1);assert.equal((await coordinator.getRequest(first.requestId)).isFulfilled,true,'existing timeout path remains usable');
   const report={passed:true,chainId:31337,database,elapsedMs:Date.now()-started,workerInstances:2,restarts:1,commitments:2,reveals:2,signedCursorApi:true,pinnedDecisionPreserved:true,lostCursorAckRecovered:!loseCursorAck,timeoutFinalization:'explicit local test transaction only',simulatedBlocks:6000,workerStates:states,disclosures:['Synthetic hospital API returns invalid proof','Local time/block manipulation','No mailbox/storage/public-network calls','Frozen XGBoost identity unchanged']};
   const out=path.join(root,'verification-results/oracle-compatibility-2026-11-06');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'enabled-workers.json'),JSON.stringify(report,null,2));
  }finally{
   for(const w of children){if(w.child.exitCode===null)w.child.kill();await w.exited;}
   for(const server of servers.reverse())await close(server);
   await mongoose.disconnect();
   for(const [key,value]of Object.entries(savedEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
   const out=path.join(root,'verification-results/oracle-compatibility-2026-11-06');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'enabled-worker-logs.txt'),logs.join('\n'));
  }
 });
});


