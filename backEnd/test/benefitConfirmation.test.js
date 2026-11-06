const test=require('node:test'),assert=require('node:assert/strict'),{ethers}=require('ethers');
const load=require('./helpers/loadIsolatedModule');
const owner='0x'+'2'.repeat(40),target='0x'+'1'.repeat(40),other='0x'+'3'.repeat(40),hash=ethers.id('refund');
const iface=new ethers.Interface(require('../abi/PolicyBenefitsManager.json').abi);
async function confirm({sponsored=false,wrongActor=false,forged=false,wrongRequest=false}={}){
 const tx={from:sponsored?other:owner,to:sponsored?other:target,data:sponsored?'0x':iface.encodeFunctionData('approveBenefit',[1])};
 const receipt={status:1,logs:[{address:forged?other:target,...iface.encodeEventLog(iface.getEvent('BenefitApproved'),[wrongRequest?2:1,100])}]};
 const contract={target,interface:new ethers.Interface(require("../abi/policyBenefitsAbi")),runner:{getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt,send:async()=>({type:'CALL',from:wrongActor?other:owner,to:target,input:iface.encodeFunctionData('approveBenefit',[1])})}};
 const controller=load('controllers/policyBenefitsController.js',{'../services/policyBenefitsService':{getReadOnlyBenefitsContract:()=>contract,getBenefitsAddress:()=>target},'../services/adminActionLogService':{logAdminAction:async()=>{}}});
 let error,body;await controller.approveBenefitRequest({params:{requestId:'1'},body:{transactionHash:hash},user:{walletAddress:owner,role:'ADMIN'}},{status(){return this;},json(v){body=v;return this;}},e=>error=e);return {error,body};
}
test('retained refund approval confirms direct wallet',async()=>assert.equal((await confirm()).error,undefined));
test('retained refund approval confirms a proven sponsored actor',async()=>assert.equal((await confirm({sponsored:true})).error,undefined));
for(const [name,patch]of [['wrong actor',{sponsored:true,wrongActor:true}],['forged event',{sponsored:true,forged:true}],['wrong request',{sponsored:true,wrongRequest:true}]])test('refund confirmation rejects '+name,async()=>assert.ok((await confirm(patch)).error));
