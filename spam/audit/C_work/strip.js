const fs=require('fs');
const f=process.argv[2];
let h=fs.readFileSync(f,'utf8');
h=h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ');
h=h.replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)[^>]*>/gi,'\n');
h=h.replace(/<[^>]+>/g,' ');
h=h.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x27;/g,"'");
h=h.split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
console.log(h);
