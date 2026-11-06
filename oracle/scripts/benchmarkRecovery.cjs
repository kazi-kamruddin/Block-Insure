const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const {createScanRecovery}=require('../scanRecovery');
const oldSource=fs.readFileSync(path.join(__dirname,'../test/fixtures/protocol-v4-index.txt'),'utf8');
const oldPoll=oldSource.slice(oldSource.indexOf('const pollOracleRequests ='),oldSource.indexOf('const startOracle ='));
(async()=>{
 const size=1200000,pollMs=15000;let oldMs=0,oldReads=0,oldWrites=0,oldHead=0;
 const c={ORACLE_INSTANCE_ID:"1",isPolling:false,serviceState:{},provider:{getBlockNumber:async()=>{oldHead++;oldMs+=10;return size-1;}},nextOracleScanBlock:0,ORACLE_EVENT_QUERY_CHUNK_SIZE:2000,coordinator:{queryFilter:async()=>{oldReads++;oldMs+=50;return [];},filters:{OracleRequested:()=>1,RegistrySnapshotPublished:()=>2}},persistCursor:async()=>{oldWrites++;oldMs+=10;},sendHeartbeat:async()=>{},Date,console};
 vm.createContext(c);vm.runInContext(oldPoll+'\nthis.run=pollOracleRequests;',c);
 let oldCycles=0;while(c.nextOracleScanBlock<size){if(oldCycles)oldMs+=pollMs;await c.run();oldCycles++;}
 const before={cycles:oldCycles,eventQueries:oldReads,headReads:oldHead,checkpointWrites:oldWrites,elapsedMs:oldMs};
 let next=0,newMs=0,newReads=0,newWrites=0,newHead=0,newCycles=0;
 const run=createScanRecovery({getHead:async()=>{newHead++;newMs+=10;return size-1;},getNext:()=>next,readRange:async()=>{newReads+=2;newMs+=100;return [];},processEvent:async()=>true,persist:async()=>{newWrites++;newMs+=10;},advance:n=>next=n,now:()=>newMs,yieldWork:async()=>{}});
 while(next<size){const r=await run();assert.equal(r.error,undefined);newCycles++;if(next<size)newMs+=r.delayMs;}
 assert.equal(newReads,oldReads);assert.equal(newWrites,oldWrites);
 // Reproduce original unsafe in-memory advancement when persistence fails.
 c.nextOracleScanBlock=0;c.persistCursor=async()=>{throw Error('synthetic persistence failure');};c.console={error:()=>{}};await c.run();assert.equal(c.nextOracleScanBlock,2000);
 const report={workload:{blocks:size,range:2000,events:0,pollMs,syntheticQueryCostMs:50,syntheticHeadReadMs:10,syntheticCheckpointMs:10,clock:'deterministic simulated; not public timing'},before,after:{cycles:newCycles,eventQueries:newReads,headReads:newHead,checkpointWrites:newWrites,elapsedMs:newMs},originalPersistenceFailure:{unacknowledgedInMemoryCursor:c.nextOracleScanBlock},note:'Both scan all 600 ranges. New cycles retain per-range checkpoints; no provider benchmark or hosted ETA.'};
 const output=process.argv[2];if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
