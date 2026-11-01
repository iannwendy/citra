import { chromium } from 'playwright';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const id=process.argv[2]||'29';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:1800},deviceScaleFactor:3,colorScheme:'light',locale:'en-US'});
await ctx.addInitScript(()=>{localStorage.setItem('theme','light');localStorage.setItem('language','en');});
const p=await ctx.newPage();
await p.goto('http://localhost:5173/login',{waitUntil:'networkidle'});
await p.fill('#username','admin@example.com');await p.fill('#password','admin123');await p.click('button[type=submit]');
await p.waitForURL(/dashboard/).catch(()=>{});await sleep(1500);
await p.goto(`http://localhost:5173/verification/report/${id}`,{waitUntil:'networkidle'});await sleep(4000);
await p.getByText(/Metadata \(\d+\)/).first().click().catch(e=>console.log('nometa'));await sleep(2000);
await p.screenshot({path:`public/shots/tall-meta-${id}.png`});
// click 2nd metadata card if exists
const cards=p.locator('text=METADATA_ERROR');console.log('cards',await cards.count());
await b.close();
