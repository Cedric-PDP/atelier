// Loads the wiki engine in an isolated vm context with several model variants exposed as MODELS[name].
const fs=require('fs'),vm=require('vm');
const [engineFile,modelsSpec,driverFile,outFile]=process.argv.slice(2);
const MODELS={};for(const kv of modelsSpec.split(';')){const [k,f]=kv.split('=');MODELS[k]=JSON.parse(fs.readFileSync(f,'utf8'))}
const out={};const first=Object.values(MODELS)[0];
const ctx=vm.createContext({self:{postMessage(){}},console,Date,MODELS,OUT:out,fetch:async()=>({ok:true,json:async()=>first})});
vm.runInContext(fs.readFileSync(engineFile,'utf8'),ctx);
(async()=>{await vm.runInContext(fs.readFileSync(driverFile,'utf8'),ctx,{timeout:3600000});fs.writeFileSync(outFile,JSON.stringify(out,null,1));console.log('done',Object.keys(out))})().catch(e=>{console.error('ERR',e.stack);process.exit(1)});
