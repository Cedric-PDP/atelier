const {runAll,W}=require('./lib.js');const fs=require('fs');
const m=JSON.parse(fs.readFileSync(require('./lib.js').MODEL,'utf8'));
const idxOf=n=>m.cards.findIndex(c=>c.number===n);
const user=[1,2,3,4,5,6,12,27,30,33,69,82,102,103,116,117,153,156,158,160,180,227,238,243,251,259].map(idxOf);
(async()=>{
 const t=Date.now();
 const r=await runAll([
  {name:'test_X',force:true,P:{task:'X',mode:'none',data:[[idxOf(103),idxOf(238),idxOf(156),idxOf(117)],[idxOf(117),idxOf(156),idxOf(238),idxOf(103)]]}},
  {name:'test_col',force:true,P:{task:'collections',mode:'best-one',data:[{pid:0,cards:user}]}}
 ],2);
 console.log(JSON.stringify(r[0].res),r[0].ms);
 console.log(JSON.stringify(r[1].res),r[1].ms);
})();
