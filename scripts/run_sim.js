// Runs the wiki's simulation worker inside an isolated vm context (no require/process/fs exposed).
const fs=require('fs'),vm=require('vm');
const [engineFile,modelFile,cardsFile,numbersFile,outFile]=process.argv.slice(2);
const modelText=fs.readFileSync(modelFile,'utf8');
const cards=JSON.parse(fs.readFileSync(cardsFile,'utf8')).cards;
const nums=fs.readFileSync(numbersFile,'utf8').trim().split(/\s+/).map(Number);
const ids=cards.filter(c=>nums.includes(c.number)).map(c=>c.id);
let resolve;const done=new Promise(r=>resolve=r);
const self={postMessage:m=>resolve(m)};
const ctx=vm.createContext({self,console,setTimeout,clearTimeout,
  fetch:async()=>({ok:true,json:async()=>JSON.parse(modelText)})});
vm.runInContext(fs.readFileSync(engineFile,'utf8'),ctx,{timeout:600000});
const msg=JSON.parse(process.env.SIM_MSG||'null')||{kind:'collection',cardIds:ids};
self.onmessage({data:Object.assign({requestId:1,modelUrl:'local',engineHash:'a8193b3d422a54a9'},msg)});
done.then(m=>{fs.writeFileSync(outFile,JSON.stringify(m,null,1));console.log('ids',ids.length,'keys',Object.keys(m.collection||m.result||m));});
