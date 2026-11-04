// GS28: where a GS1 build keeps each relocated data symbol (orchestrator D19). Reads the build's own reloc table
// (gPortRelocs, found in its memory by the rows of the matching gen/reloc_table.ll); no ROM needed.
// Usage: node tools/reloc_map.cjs BUILD/game.js BUILD/gen/reloc_table.ll > map.tsv
// Prints per symbol: buffer (hex), GBA address (hex), size, overlay (hex), name. Used for port/pc/save_legacy.h.
const fs=require('fs'),path=require('path');
const [js,ll]=process.argv.slice(2);
const t=fs.readFileSync(ll,'utf8');
const rows=[...t.matchAll(/\{ ptr @"reloc_([^"]+)", i32 (-?\d+), i32 (\d+), i32 (\d+), i32 (\d+), i32 (\d+) \}/g)].map(m=>({name:m[1],gba:(+m[2])>>>0,size:+m[3],first:+m[4],count:+m[5],ov:+m[6]}));
require(path.resolve(js))({print:()=>{},printErr:()=>{}}).then(m=>{
  const u=m.HEAPU32, r0=rows[0];
  let p=-1;
  for(let i=0x10000/4;i<0x2000000/4;i++) if(u[i+1]===r0.gba&&u[i+2]===r0.size&&u[i+3]===r0.first&&u[i+4]===r0.count&&u[i+5]===r0.ov){p=i;break;}
  if(p<0){console.error('table not found');process.exit(1);}
  rows.forEach((r,k)=>{const q=p+k*6; if(u[q+1]!==r.gba||u[q+2]!==r.size) {console.error('mismatch row',k);process.exit(1);}
    console.log([u[q].toString(16),r.gba.toString(16),r.size,r.ov.toString(16),r.name].join('\t'));});
  process.exit(0);
});
