const fs=require('fs');
let h=fs.readFileSync(process.argv[2],'utf8');
h=h.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<astro-island[^>]*>/gi,'');
h=h.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi,'\n').replace(/<h([1-6])[^>]*>/gi,(m,n)=>'\n'+'#'.repeat(+n)+' ').replace(/<li[^>]*>/gi,'- ').replace(/<[^>]+>/g,' ');
h=h.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ');
h=h.split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
fs.writeFileSync(process.argv[3],h);console.log(process.argv[3].split('/').pop(),h.length);
