// 1.20: (a) inertness check of engine120_thaw.js vs original on 60 decks, (b) freeze with/without thaw on the 6 named E1 decks
const fs=require('fs'),vm=require('vm'),path=require('path');
const SP=path.resolve(__dirname,'../../../..');
const txt=fs.readFileSync(SP+'/spam/js/model.json','utf8');
const load=f=>{const model=JSON.parse(txt);const c=vm.createContext({self:{postMessage(){}},console,Date});vm.runInContext(fs.readFileSync(f,'utf8'),c);c.__model=model;return c};
const A=load(SP+'/spam/js/simulation.js'),B=load(__dirname+'/engine120_thaw.js');
const decks=JSON.parse(fs.readFileSync(SP+'/spam/audit/E1/decks.json','utf8'));
const sel=ids=>ids.map(id=>({id,talentId:null})),OPT={optimize:false,suggestions:false,shop:false};
const IA=A.ht(A.__model);B.STRESS=undefined;const IB=B.ht(B.__model);
let mx=0,ident=0;const n=60;
for(const d of decks.slice(0,n)){const a=IA.evaluate(sel(d.ids),OPT),b=IB.evaluate(sel(d.ids),OPT);mx=Math.max(mx,Math.abs(a.score-b.score));if(JSON.stringify(a)===JSON.stringify(b))ident++}
const out={validation:{decks:n,maxAbsDiff:mx,identicalJSON:ident},decks:[]};
const named=decks.filter(d=>!d.label.startsWith('top#'));
const scen=[];
for(const thaw of [false,true])for(const smart of [false,true])for(let p=0;p<4;p++)scen.push({id:(thaw?'D':'')+(smart?'T':'F')+p,stress:{freeze:smart?{idx:p,smart:true,cd:3,from:2,shatter:40,thaw}:{idx:p,turns:[2,5,8],shatter:40,thaw}}});
for(const d of named)out.decks.push({label:d.label,nums:d.nums,scores:{}});
B.STRESS=undefined;let I=B.ht(B.__model);named.forEach((d,k)=>out.decks[k].base=I.evaluate(sel(d.ids),OPT).score);
for(const s of scen){B.STRESS=Object.assign({on:true},s.stress);I=B.ht(B.__model);named.forEach((d,k)=>out.decks[k].scores[s.id]=I.evaluate(sel(d.ids),OPT).score)}
for(const d of out.decks){const w=pre=>{let best=null;for(const k of Object.keys(d.scores).filter(k=>pre.test(k)))if(!best||d.scores[k]<best.v)best={v:d.scores[k],k,card:d.nums[+k.slice(-1)]};return best};
 d.Fz3=w(/^[FT]\d$/);d.Fz3d=w(/^D[FT]\d$/);d.Fz3pct=Math.round((d.Fz3.v-d.base)/d.base*1000)/10;d.Fz3dpct=Math.round((d.Fz3d.v-d.base)/d.base*1000)/10;
 d.fixedNoThaw=Math.round((Math.min(...[0,1,2,3].map(p=>d.scores['F'+p]))-d.base)/d.base*1000)/10;}
fs.writeFileSync(__dirname+'/thaw120.json',JSON.stringify(out,null,1));
console.log(JSON.stringify(out.validation));for(const d of out.decks)console.log(d.label.padEnd(28),'base',Math.round(d.base),'fixed 2/5/8 no thaw',d.fixedNoThaw,'Fz3',d.Fz3pct,'#'+d.Fz3.card,d.Fz3.k,'Fz3d',d.Fz3dpct,'#'+d.Fz3d.card,d.Fz3d.k);
