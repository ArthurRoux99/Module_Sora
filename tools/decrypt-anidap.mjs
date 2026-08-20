// Validation du déchiffrement anidap (reproduction du bundle VideoPlayer.js)
import crypto from 'node:crypto';

// ── constantes extraites du bundle ──
const lr = new Uint8Array([53,79,20,124,11,168,97,237,17,83,47,66,36,89,56,209,190,244,158,212,225,62,134,101,75,241,169,172,190,181,117,71]);
const dn = ((e=>e*e*e)(6)+47)*60*1e3; // 15780000
const kt = new Uint8Array(Array.from({length:32},((e,t)=>(t*17+53^t*23+79^t*31+124)&255)));
const Me = [13,27,7,19,31,11,23,37,41,43,47,53,59,61,67,71,73,79,83,89,97,101,103,107,109,113,127,131,137,139,149,151];

// helpers
const Qe = e => String.fromCharCode(...e);
const He = (e,t,n)=>((e^t)<<1^(t^n)>>1^e+t+n)&255;
const Rt = (e,t)=>e[t%e.length]^e[(t*7+11)%e.length]^e[(t*13+17)%e.length];
function fr(e,t){const n=new Uint8Array(e.length);for(let r=0;r<e.length;r++){const a=r%t.length,c=t[a],l=(c<<r%8|c>>>8-r%8)&255,i=r*7+13&255;n[r]=e[r]^l^i^t[(a+1)%t.length]}return n}
function mt(e){for(;e.length%4;)e+="=";return atob(e.replace(/-/g,"+").replace(/_/g,"/"))}

let pt=null, dr=0;
async function Sd(offset=0){
  if(pt && Date.now()<dr) return pt;
  const e=Math.floor(Date.now()/dn)+offset;
  const t=new Uint8Array(128);
  for(let i=0;i<128;i++){const d=Me[i%Me.length];t[i]=Rt(kt,i)^e+i*d&255^(i^d)&255}
  const n=new Uint8Array(64),r=new Uint8Array(32),a=new Uint8Array(16);
  for(let i=0;i<64;i++){const d=t[i],p=t[i+64],u=He(d,p,e>>>i%16&255);n[i]=d^u}
  for(let i=0;i<32;i++){const d=n[i],p=n[i+32],u=Me[(i*3+7)%Me.length];r[i]=(d^p^d+p+u&255)&255}
  for(let i=0;i<16;i++){const d=r[i],p=r[i+16],u=((d<<3|d>>>5)^(p<<5|p>>>3))&255;a[i]=u^e>>>i*2&255}
  const c=new Uint8Array(48);
  for(let i=0;i<48;i++){const d=(i*7+11)%32,p=(i*13+17)%32,u=(i*19+23)%32,f=He(r[d],r[p],r[u]);c[i]=(f^e>>>i%24&255^Rt(kt,i*3))&255}
  const l=new Uint8Array(32);
  for(let i=0;i<3;i++)for(let d=0;d<32;d++){const p=i===0?c[d]:l[d],u=c[(d*5+7)%48],f=c[(d*11+13)%48],g=He(p,u,f);l[d]=(g^c[(d+i*16)%48])&255}
  if(typeof crypto!=="undefined"&&crypto.subtle){
    const i=await crypto.subtle.importKey("raw",l,{name:"AES-GCM"},false,["encrypt","decrypt"]);
    return l.fill(0),pt={aesKey:i,xorKey:a},dr=Date.now()+dn,pt;
  }
  return l.fill(0),{aesKey:null,xorKey:a};
}
async function js(e, offset=0){
  const {aesKey:t,xorKey:n}=await Sd(offset);
  const r=Uint8Array.from(mt(e),d=>d.charCodeAt(0));
  const a=r.slice(0,12),c=r.slice(12);
  const l=await crypto.subtle.decrypt({name:"AES-GCM",iv:a},t,c);
  const i=fr(new Uint8Array(l),n);
  return new TextDecoder().decode(i);
}

// ── test sur chaîne live ──
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const enc = await fetch("https://anidap.lol/api/anime/sources?id=frieren-beyond-journey-s-end-faato&ep=1&host=1&type=sub",{headers:{"User-Agent":UA,"Referer":"https://anidap.lol/"}}).then(r=>r.json());
console.log("sources success:",enc.success,"| data len:",enc.data?.length);
if(enc.data){
  for(const off of [0,-1,1,-2,2]){
    try{
      const dec = await js(enc.data, off);
      if(dec && dec.includes("http")){ console.log(`[off=${off}] DECRYPTED:`, dec.slice(0,400)); break; }
      else console.log(`[off=${off}] raw:`, dec?.slice(0,80));
    }catch(err){console.log(`[off=${off}] err:`,err.message);}
  }
}

// ── sanity: roundtrip chiffre/déchiffre avec notre propre Sd ──
{
  const {aesKey, xorKey} = await Sd(0);
  const plaintext = "https://example.com/flux.m3u8|sub";
  // serveur fait: fr(plaintext, xorKey) puis AES-GCM(chiffre)
  const xored = fr(new TextEncoder().encode(plaintext), xorKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, aesKey, undefined).catch(()=>null) || await crypto.subtle.encrypt({name:"AES-GCM", iv}, aesKey, xored);
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv); combined.set(new Uint8Array(ct), iv.length);
  const b64 = Buffer.from(combined).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const back = await js(b64, 0);
  console.log("ROUNDTRIP:", back === plaintext ? "OK ✓" : "FAIL ✗ ("+back.slice(0,40)+")");
}
