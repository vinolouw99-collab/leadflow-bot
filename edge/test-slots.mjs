import { handle } from './src/core.js';
const slots=['Sat 10:00','Sat 12:00','Sun 14:00']; let ok=true;
for (const [i,s] of slots.entries()) {
  const store={}; const env={GEMINI_API_KEY:'x',STATE:{get:async(k)=>store[k]?JSON.parse(store[k]):null,put:async(k,v)=>{store[k]=v;}}};
  store['c:1']=JSON.stringify({stage:'offer',offered:slots,lead:{name:'T'},history:[],started:'x'});
  globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);const t=b.contents.at(-1).parts[0].text;
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({reply:'ok',lead:{},qualified:true,chosenSlot:slots.includes(t)?t:null})}]}}]})};};
  await handle(env,'1',String(i+1));
  const c=JSON.parse(store['c:1']); const pass=c.booked===s; ok&&=pass; console.log(`"${i+1}" -> ${c.booked} ${pass?'PASS':'FAIL'}`);
}
process.exit(ok?0:1);
