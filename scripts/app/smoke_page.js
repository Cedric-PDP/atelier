// Runs the page script against a minimal fake DOM to catch runtime errors in every view.
const fs=require('fs'),path=require('path');
const [htmlFile,siteDir]=process.argv.slice(2);
const code=fs.readFileSync(htmlFile,'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
class El{constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.dataset={};this.listeners={};this.style={};this.clientWidth=640;this.offsetWidth=120;this.offsetHeight=30}
 addEventListener(t,f){(this.listeners[t]=this.listeners[t]||[]).push(f)} setAttribute(){} getAttribute(){return null}
 querySelectorAll(){return []} querySelector(){return null} closest(){return null}
 insertAdjacentHTML(p,h){this.innerHTML=h+this.innerHTML} getBoundingClientRect(){return{left:0,top:0,width:10,height:10}}}
const els={};const document={getElementById:id=>els[id]||(els[id]=new El(id)),addEventListener(){}};
const ls={};const localStorage={getItem:k=>k in ls?ls[k]:null,setItem:(k,v)=>{ls[k]=String(v)}};
const win={addEventListener(){},innerWidth:1200,scrollTo(){},claude:undefined};
const fetchF=async f=>{const p=path.join(siteDir,f);if(!fs.existsSync(p))return{ok:false,status:404};return{ok:true,json:async()=>JSON.parse(fs.readFileSync(p,'utf8'))}};
const errors=[];process.on('unhandledRejection',e=>errors.push('UNHANDLED '+(e&&e.stack||e)));
new Function('window','document','fetch','localStorage',code)(win,document,fetchF,localStorage);
const bad=(name,h)=>{const m=String(h).match(/undefined|NaN|\[object Object\]/g);if(m)errors.push(name+' contains '+[...new Set(m)].join(','));};
const click=id=>els[id].listeners.click.forEach(f=>f({target:{closest:()=>null}}));
setTimeout(async()=>{
 try{
  bad('analysis',els.analysis.innerHTML);fs.writeFileSync(path.join(siteDir,'_analysis.html'),els.analysis.innerHTML);bad('slots',els.slots.innerHTML);bad('card-list',els['card-list'].innerHTML);
  console.log('subtitle:',els.subtitle.textContent);
  console.log('analysis length',els.analysis.innerHTML.length,'| has verdict',/Score du modèle/.test(els.analysis.innerHTML),'| shop section:',(els.analysis.innerHTML.match(/<h2>Boutique<\/h2><p>([^<]*)/)||[])[1]);
  const big=els.analysis.innerHTML.match(/class="big">([^<]*)/);console.log('hero score',big&&big[1]);
  const lines=els.analysis.innerHTML.match(/Mieux que <b>[^<]*<\/b>[^<]*/);console.log(lines&&lines[0]);
  console.log('hist svg',/<svg/.test(els['hist-global'].innerHTML),'mu svg',/<svg/.test(els['mu-chart'].innerHTML));
  bad('hist-global',els['hist-global'].innerHTML);bad('mu-chart',els['mu-chart'].innerHTML);bad('hist-table',els['hist-table'].innerHTML);
  click('tab-top');bad('top-table',els['top-table'].innerHTML);console.log('top summary:',els['top-summary'].textContent,'rows',(els['top-table'].innerHTML.match(/<tr>/g)||[]).length);
  els['top-wish'].checked=true;els['top-crit'].value='20';els['top-sort'].value='s0';els['top-crit'].listeners.input.forEach(f=>f());console.log('top filtered:',els['top-summary'].textContent);
  click('tab-atelier');els['deck-name'].value='test A';click('save-deck');await new Promise(r=>setTimeout(r,5));els['deck-name'].value='test B';click('save-deck');
  const saved=JSON.parse(ls['spam-saved-local']||'[]');console.log('saved local',saved.length,saved.map(d=>d.name).join(','));
  click('tab-mine');bad('saved-list',els['saved-list'].innerHTML);
  for(const d of saved)els['saved-list'].listeners.change.forEach(f=>f({target:{closest:()=>({checked:true,dataset:{cmp:d.id}})}}));
  bad('compare',els.compare.innerHTML);console.log('compare has table',/<table>/.test(els.compare.innerHTML),'svg',/<svg/.test(els['cmp-hist'].innerHTML));
  // « Nouveautés » tab, when the data carries a changelog (build_changelog.js)
  if(JSON.parse(fs.readFileSync(path.join(siteDir,'data.json'),'utf8')).changelog){click('tab-news');bad('news',els.news.innerHTML);
    console.log('news panels',(els.news.innerHTML.match(/class="panel stack"/g)||[]).length,'rows',(els.news.innerHTML.match(/<tr>/g)||[]).length,'| tab:',els['tab-news'].textContent);}
  else console.log('news: no changelog in data.json');
  // partial deck -> completions
  click('tab-atelier');click('clear-deck');bad('analysis-empty',els.analysis.innerHTML);
 }catch(e){errors.push('THROW '+e.stack)}
 console.log(errors.length?'ERRORS:\n'+errors.join('\n'):'NO RUNTIME ERRORS');
},1500);
