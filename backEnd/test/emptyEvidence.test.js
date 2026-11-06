const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/loadIsolatedModule');
test('empty evidence never asserts document integrity',async()=>{
 const chain=load('services/evidenceChainService.js',{'../models/File':{find:()=>({select(){return this;},sort:async()=>[]})}});
 for(const id of ['', '4']){const result=await chain.getEvidenceChainForClaim(id);assert.equal(result.documentCount,0);assert.equal(result.verified,false);assert.deepEqual(result.documents,[]);}
});
