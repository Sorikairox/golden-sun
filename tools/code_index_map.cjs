// GS28: a GS1 build's function table index of each code map function (gPortCodeMap, found in its memory by the
// rows of the matching gen/code_map.ll). Usage: node tools/code_index_map.cjs BUILD/game.js BUILD/gen/code_map.ll
// Prints: table index (hex), GBA address (hex), overlay (hex), name. Used for port/pc/save_legacy.h.
const fs=require('fs'),path=require('path');
const [js,ll]=process.argv.slice(2);
const t=fs.readFileSync(ll,'utf8');
const rows=[...t.matchAll(/\{ i32 (-?\d+), i32 (\d+), ptr @"([^"]+)" \}/g)].map(m=>({gba:(+m[1])>>>0,ov:+m[2],name:m[3]}));
require(path.resolve(js))({print:()=>{},printErr:()=>{}}).then(m=>{
  const u=m.HEAPU32;let p=-1;
  for(let i=0x10000/4;i<0x2000000/4;i++) if(u[i]===rows[0].gba&&u[i+1]===rows[0].ov&&u[i+3]===rows[1].gba&&u[i+4]===rows[1].ov){p=i;break;}
  if(p<0){console.error('not found');process.exit(1);}
  rows.forEach((r,k)=>{const q=p+k*3; if(u[q]!==r.gba){console.error('mismatch',k);process.exit(1);} console.log([u[q+2].toString(16),r.gba.toString(16),r.ov.toString(16),r.name].join('\t'));});
  process.exit(0);
});
