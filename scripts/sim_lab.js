// Loads the wiki engine in an isolated vm context, then runs a driver snippet inside that context.
const fs=require('fs'),vm=require('vm');
const [engineFile,modelFile,cardsFile,numbersFile,driverFile,outFile]=process.argv.slice(2);
const modelText=fs.readFileSync(modelFile,'utf8');
const cards=JSON.parse(fs.readFileSync(cardsFile,'utf8')).cards;
const nums=fs.readFileSync(numbersFile,'utf8').trim().split(/\s+/).map(Number);
const ids=cards.filter(c=>nums.includes(c.number)).map(c=>c.id);
const out={};
const ctx=vm.createContext({self:{postMessage(){}},console,Date,
  fetch:async()=>({ok:true,json:async()=>JSON.parse(modelText)}),IDS:ids,OUT:out});
vm.runInContext(fs.readFileSync(engineFile,'utf8'),ctx);
(async()=>{
  await vm.runInContext(`xt('local','a8193b3d422a54a9')`,ctx);
  await vm.runInContext(fs.readFileSync(driverFile,'utf8'),ctx,{timeout:3600000});
  fs.writeFileSync(outFile,JSON.stringify(out,null,1));console.log('done',Object.keys(out));
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
