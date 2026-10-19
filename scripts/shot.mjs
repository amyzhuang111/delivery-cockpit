import p from 'puppeteer-core';
const [url,out,w]=process.argv.slice(2);
const b=await p.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const pg=await b.newPage();await pg.setViewport({width:+w||1440,height:900});
await pg.goto(url,{waitUntil:'networkidle2',timeout:60000});await new Promise(r=>setTimeout(r,1500));
await pg.screenshot({path:out,fullPage:process.argv[5]==='full'});
const st=await pg.evaluate(()=>{const s=getComputedStyle(document.body);const h=document.querySelector('h1');return {bg:s.backgroundColor,color:s.color,font:s.fontFamily,h1:h&&getComputedStyle(h).fontFamily,h1w:h&&getComputedStyle(h).fontWeight,h1s:h&&getComputedStyle(h).fontSize, sw:document.documentElement.scrollWidth}});
console.log(JSON.stringify(st));await b.close();
