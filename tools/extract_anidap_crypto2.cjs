const fs=require("fs");
const s=fs.readFileSync("C:/Users/Arthur PC/AppData/Local/Temp/an_vp_fresh.js","utf8");

function extractBalanced(startIdx){
  // startIdx points at the start of "async function Sd(" or "async function js("
  let i=s.indexOf("{",startIdx);
  let depth=0, started=false;
  for(;i<s.length;i++){
    if(s[i]==="{"){depth++;started=true;}
    else if(s[i]==="}"){depth--;if(started&&depth===0){return s.slice(startIdx,i+1);}}
  }
  return s.slice(startIdx);
}

const out=[];
// constants (single-line)
out.push(s.slice(s.indexOf("const lr=new Uint8Array"), s.indexOf("const lr=new Uint8Array")+200));
out.push("const "+s.slice(s.indexOf("dn=("), s.indexOf("dn=(")+90));
out.push("const "+s.slice(s.indexOf("kt=new Uint8Array"), s.indexOf("kt=new Uint8Array")+150));
out.push("const "+s.slice(s.indexOf("Me=["), s.indexOf("Me=[")+160));
// helpers (single-line-ish, grab a safe window)
out.push("function Qe(e){return String.fromCharCode(...e)}");
out.push(s.slice(s.indexOf("He=(e,t,n)"), s.indexOf("He=(e,t,n)")+130).split(";")[0]+";");
out.push(s.slice(s.indexOf("Rt=(e,t)"), s.indexOf("Rt=(e,t)")+130).split(";")[0]+";");
// fr + mt (grab balanced-ish: find "function fr(e,t){" then next "}" after its body — use simple index of "return n}" )
const frI=s.indexOf("function fr(e,t)");
out.push(s.slice(frI, s.indexOf("return n}",frI)+8));
const mtI=s.indexOf("function mt(e)");
out.push(s.slice(mtI, s.indexOf("}",mtI)+1));
// Sd + js (balanced)
const sdI=s.indexOf("async function Sd()");
out.push(extractBalanced(sdI));
const jsI=s.indexOf("async function js(e)");
out.push(extractBalanced(jsI));

const code=out.join("\n\n")+"\n\nmodule.exports={Sd,js,Me,kt,dn,lr};";
fs.writeFileSync("C:/Users/Arthur PC/AppData/Local/Temp/anidap_crypto_clean.cjs",code);
console.log("written",code.length,"bytes");
console.log("checks: Sd?",code.includes("async function Sd"),"js?",code.includes("async function js"),"fr?",code.includes("function fr"),"Me?",code.includes("Me=["));
