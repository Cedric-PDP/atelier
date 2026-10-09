// node mkdrv.js <template.js> <out.js> : replaces __DECKS__ with {name:[ids]} from card numbers, __NUM2ID__ with number->id map
const fs=require('fs');
const [tpl,out]=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(__dirname+'/../../js/model.json','utf8'));
const byNum={};for(const c of m.cards)byNum[c.number]=c.id;
const decks={chimere:[103,238,156,117],anticrit:[12,238,27,117],zerocrit:[102,116,12,69],alt1:[3,103,117,238],alt2:[69,160,227,238]};
const D={};for(const [k,v] of Object.entries(decks))D[k]=v.map(n=>byNum[n]);
let s=fs.readFileSync(tpl,'utf8').replace('__DECKS__',JSON.stringify(D)).replace('__NUM2ID__',JSON.stringify(byNum));
fs.writeFileSync(out,s);
