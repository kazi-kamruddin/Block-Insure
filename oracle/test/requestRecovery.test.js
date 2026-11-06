const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {ethers}=require('ethers');const {requestDisposition}=require('../scanRecovery');
const source=fs.readFileSync(require.resolve('../index'),'utf8');
const handler=source.slice(source.indexOf('const handleOracleRequested ='),source.indexOf('const positiveConfig ='));
for(const instance of ['1','2'])test(`actual handler Oracle ${instance} skips expired then handles fulfilled without model/API/transactions`,async()=>{
 const warnings=[];const requests={1:{commitDeadlineBlock:10,revealDeadlineBlock:20},2:{isFulfilled:true}};
 const context={processingRequests:new Set(),Date,coordinator:{getRequest:async id=>requests[id],hasRevealed:async()=>false,eligibleForRequest:async()=>true,commitments:async()=>ethers.ZeroHash},oracleWallet:{address:ethers.ZeroAddress},provider:{getBlockNumber:async()=>30},ethers,requestDisposition,ORACLE_INSTANCE_ID:instance,console:{warn:s=>warnings.push(s)},resolveRequestModel:()=>{throw Error('expired request must not evaluate');}};
 vm.createContext(context);vm.runInContext(handler+'\nthis.handle=handleOracleRequested;',context);
 assert.equal(await context.handle(1,1),true);assert.equal(await context.handle(2,2),true);
 assert.equal(warnings.length,1);assert.match(warnings[0],/timeout\/finalization required/);assert.equal(context.processingRequests.size,0);
});
test('actual reveal-phase check yields pending work without sleeping and permits deadline-inclusive reveal',async()=>{
 const part=source.slice(source.indexOf('const waitForRevealPhase ='),source.indexOf('const handleOracleRequested'));
 let block=5,count=1;const context={stopping:false,oracleWallet:{address:ethers.ZeroAddress},provider:{getBlockNumber:async()=>block},coordinator:{getRequest:async()=>({commitDeadlineBlock:10,revealDeadlineBlock:20,expectedResponses:2}),hasRevealed:async()=>false,commitmentCount:async()=>count}};
 vm.createContext(context);vm.runInContext(part+'\nthis.wait=waitForRevealPhase;',context);
 await assert.rejects(context.wait(1),e=>e.deferred===true);count=2;assert.ok(await context.wait(1));count=1;block=11;assert.ok(await context.wait(1));block=21;assert.ok(await context.wait(1));context.stopping=true;await assert.rejects(context.wait(1),/stopping/);
});
