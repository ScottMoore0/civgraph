import io,os
DATA=open('/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/map_data.js',encoding='utf-8').read()

HTML = r'''<title>Projected Irish Unity Referendum — Northern Ireland</title>
<style>
:root{
  --bg:#0e1218; --panel:#171d26; --panel2:#1e2530; --line:#2b333f;
  --ink:#eef1f5; --muted:#9aa6b4; --faint:#6b7686;
  --accent:#3f9e63; --sea:#0a0d12;
  --union:#c65a2b; --mid:#e8dcc0; --unity:#1f8a4c;
  --stroke:rgba(255,255,255,.10);
}
@media (prefers-color-scheme:light){
  :root{ --bg:#f3f1ea; --panel:#ffffff; --panel2:#f7f5ef; --line:#e0dbcf;
    --ink:#1a1f27; --muted:#5c6472; --faint:#8b93a1; --sea:#dfe4e8; --stroke:rgba(20,26,34,.14); }
}
:root[data-theme="dark"]{ --bg:#0e1218; --panel:#171d26; --panel2:#1e2530; --line:#2b333f;
  --ink:#eef1f5; --muted:#9aa6b4; --faint:#6b7686; --sea:#0a0d12; --stroke:rgba(255,255,255,.10); }
:root[data-theme="light"]{ --bg:#f3f1ea; --panel:#ffffff; --panel2:#f7f5ef; --line:#e0dbcf;
  --ink:#1a1f27; --muted:#5c6472; --faint:#8b93a1; --sea:#dfe4e8; --stroke:rgba(20,26,34,.14); }

*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;overflow:hidden}
.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.app{display:flex;flex-direction:column;height:100vh;height:100dvh}

header{display:flex;align-items:baseline;gap:16px 22px;flex-wrap:wrap;
  padding:14px 20px 12px;border-bottom:1px solid var(--line);background:var(--panel);z-index:5}
.brand{display:flex;flex-direction:column;gap:2px;margin-right:auto}
h1{font-size:16px;font-weight:640;letter-spacing:-.01em;margin:0;text-wrap:balance}
.sub{font-size:11.5px;color:var(--muted);letter-spacing:.02em}
.sub b{color:var(--ink);font-weight:600}

.tabs{display:flex;gap:4px;background:var(--panel2);border:1px solid var(--line);border-radius:11px;padding:4px}
.tab{appearance:none;border:0;background:transparent;color:var(--muted);cursor:pointer;
  font:inherit;font-size:12px;font-weight:560;padding:7px 13px;border-radius:8px;display:flex;flex-direction:column;
  align-items:center;gap:1px;line-height:1.15;transition:background .15s,color .15s}
.tab .t-lvl{font-size:12.5px;font-weight:680}
.tab .t-lbl{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase}
.tab:hover{color:var(--ink)}
.tab[aria-selected="true"]{background:var(--bg);color:var(--ink);box-shadow:0 1px 0 rgba(0,0,0,.15)}
.tab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.stage{position:relative;flex:1;overflow:hidden;background:
  radial-gradient(120% 120% at 50% 0%,color-mix(in srgb,var(--sea) 82%,var(--bg)),var(--sea))}
svg{width:100%;height:100%;display:block;cursor:grab;touch-action:none}
svg.drag{cursor:grabbing}
#view path{stroke:var(--stroke);stroke-width:.35;vector-effect:non-scaling-stroke}
#view path.hot{stroke:var(--ink);stroke-width:1.4}

.panel{position:absolute;background:color-mix(in srgb,var(--panel) 88%,transparent);
  backdrop-filter:blur(8px);border:1px solid var(--line);border-radius:12px;
  box-shadow:0 6px 24px rgba(0,0,0,.22)}
.readout{top:14px;right:14px;padding:13px 15px;min-width:184px}
.readout .big{display:flex;align-items:baseline;gap:7px}
.readout .big .n{font-size:31px;font-weight:700;letter-spacing:-.02em}
.readout .big .u{font-size:14px;color:var(--muted)}
.readout .cap{font-size:9.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);margin-bottom:1px}
.readout .band{font-size:11.5px;color:var(--muted);margin-top:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:9px 14px;margin-top:12px;
  padding-top:11px;border-top:1px solid var(--line)}
.grid .k{font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint)}
.grid .v{font-size:14px;font-weight:620;margin-top:1px}

.legend{left:14px;bottom:14px;padding:11px 13px 12px;width:246px}
.legend .lt{font-size:9.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);margin-bottom:8px}
.bar{height:11px;border-radius:3px;position:relative;
  background:linear-gradient(90deg,#8f3a17,#c65a2b 26%,#e0a877 44%,#e8dcc0 50%,#86c08f 58%,#1f8a4c 76%,#0d5c30)}
.bar .thr{position:absolute;left:50%;top:-3px;bottom:-3px;width:2px;background:var(--ink);transform:translateX(-1px)}
.ticks{display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:var(--muted)}
.thrlab{margin-top:7px;font-size:10.5px;color:var(--muted);display:flex;align-items:center;gap:6px}
.thrlab .sw{width:9px;height:9px;border-radius:2px;background:var(--ink)}

.tools{position:absolute;left:14px;top:14px;display:flex;gap:6px}
.tool{appearance:none;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 88%,transparent);
  color:var(--ink);cursor:pointer;font:inherit;font-size:12px;font-weight:560;padding:7px 11px;border-radius:9px;
  backdrop-filter:blur(8px)}
.tool:hover{border-color:var(--accent)}
.tool:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.tip{position:absolute;pointer-events:none;opacity:0;transition:opacity .1s;z-index:9;
  background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:7px 10px;
  box-shadow:0 6px 20px rgba(0,0,0,.3);font-size:12px;max-width:220px;transform:translate(-50%,calc(-100% - 12px))}
.tip .nm{font-weight:620;margin-bottom:2px}
.tip .pc{color:var(--muted)}
.tip .pc b{color:var(--ink);font-weight:680}

footer{padding:8px 20px;border-top:1px solid var(--line);background:var(--panel);
  font-size:11px;color:var(--muted);display:flex;gap:16px;flex-wrap:wrap;align-items:center}
footer .dot{width:4px;height:4px;border-radius:50%;background:var(--faint)}
@media (max-width:720px){
  .readout{position:static;margin:0}
  header{gap:10px 14px}.tabs{order:3;width:100%}
  .legend{width:200px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="app">
  <header>
    <div class="brand">
      <h1>Projected Irish Unity Referendum &mdash; Northern Ireland</h1>
      <div class="sub">Data Zone projection &middot; <b>% voting for a United Ireland</b> in a Border Poll, one week after each LucidTalk poll</div>
    </div>
    <div class="tabs" role="tablist" aria-label="Poll date"></div>
  </header>

  <div class="stage">
    <svg id="map" role="img" aria-label="Choropleth of projected Irish unity vote by Data Zone">
      <g id="view"></g>
    </svg>
    <div class="tools">
      <button class="tool" id="zin" title="Zoom in" aria-label="Zoom in">+</button>
      <button class="tool" id="zout" title="Zoom out" aria-label="Zoom out">&minus;</button>
      <button class="tool" id="reset">Reset</button>
    </div>
    <div class="panel readout" id="readout"></div>
    <div class="panel legend">
      <div class="lt">Projected Unity vote</div>
      <div class="bar"><div class="thr"></div></div>
      <div class="ticks mono"><span>15%</span><span>30%</span><span>50%</span><span>70%</span><span>85%</span></div>
      <div class="thrlab"><span class="sw"></span> 50% &mdash; the threshold a Border Poll must cross</div>
    </div>
    <div class="tip" id="tip"></div>
  </div>

  <footer>
    <span>3,780 Data Zones (Census 2021)</span><span class="dot"></span>
    <span>Model: v9 &mdash; census&rarr;result gradient (multi&#8209;scale R&sup2;&nbsp;&ge;&nbsp;0.96), level from NILT&nbsp;+&nbsp;LucidTalk</span>
    <span class="dot"></span><span>Projection, not a measured result &mdash; no unity referendum has been held</span>
  </footer>
</div>

<script>__DATA__</script>
<script>
const M=window.MAP, view=document.getElementById('view'), svg=document.getElementById('map');
let cur=M.dates[M.dates.length-1];

// ---- diverging colour scale centred on 50% ----
const STOPS=[[15,'#8f3a17'],[30,'#c65a2b'],[42,'#e0a877'],[50,'#e8dcc0'],[58,'#86c08f'],[70,'#1f8a4c'],[85,'#0d5c30']];
function hex(c){return [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];}
const SP=STOPS.map(s=>[s[0],hex(s[1])]);
function colour(u){
  if(u<=SP[0][0])return STOPS[0][1]; if(u>=SP[SP.length-1][0])return STOPS[STOPS.length-1][1];
  for(let i=0;i<SP.length-1;i++){const[a,ca]=SP[i],[b,cb]=SP[i+1];
    if(u>=a&&u<=b){const t=(u-a)/(b-a);const r=ca.map((v,j)=>Math.round(v+(cb[j]-v)*t));
      return'#'+r.map(v=>v.toString(16).padStart(2,'0')).join('');}}
}
// ---- build paths once ----
const els={};
const frag=document.createDocumentFragment();
for(const code in M.paths){
  const p=document.createElementNS('http://www.w3.org/2000/svg','path');
  p.setAttribute('d',M.paths[code]); p.dataset.code=code; frag.appendChild(p); els[code]=p;
}
view.appendChild(frag);
svg.setAttribute('viewBox',`0 0 ${M.w} ${M.h}`);

function paint(date){
  const d=M.data[date];
  for(const code in els){const u=d[code]; els[code].setAttribute('fill', u==null?'#333':colour(u));}
  cur=date; buildTabs(); readout(date);
}
// ---- readout ----
function readout(date){
  const s=M.stats[date], el=document.getElementById('readout');
  el.innerHTML=`<div class="cap">NI &mdash; projected unity (${M.label[date]})</div>
   <div class="big"><span class="n mono">${s.ni.toFixed(1)}</span><span class="u">%</span></div>
   <div class="band mono">band ${s.lo.toFixed(1)}&ndash;${s.hi.toFixed(1)}% &middot; inputs LT ${s.lt} / NILT ${s.nilt}</div>
   <div class="grid">
     <div><div class="k">Majority&#8209;unity DZs</div><div class="v mono">${s.maj.toFixed(1)}%</div></div>
     <div><div class="k">Median DZ</div><div class="v mono">${s.med.toFixed(1)}%</div></div>
     <div><div class="k">10th pct DZ</div><div class="v mono">${s.p10.toFixed(1)}%</div></div>
     <div><div class="k">90th pct DZ</div><div class="v mono">${s.p90.toFixed(1)}%</div></div>
   </div>`;
}
// ---- tabs ----
const tabsEl=document.querySelector('.tabs');
function buildTabs(){
  tabsEl.innerHTML='';
  M.dates.forEach((d,i)=>{
    const b=document.createElement('button'); b.className='tab'; b.role='tab';
    b.setAttribute('aria-selected', d===cur); b.tabIndex = d===cur?0:-1;
    b.innerHTML=`<span class="t-lbl">${M.label[d]}</span><span class="t-lvl mono">${M.stats[d].ni.toFixed(1)}%</span>`;
    b.onclick=()=>paint(d);
    b.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();
      const n=(i+(e.key==='ArrowRight'?1:M.dates.length-1))%M.dates.length; paint(M.dates[n]);
      tabsEl.children[n].focus();}};
    tabsEl.appendChild(b);
  });
}
// ---- pan / zoom ----
let t={x:0,y:0,k:1};
function apply(){view.setAttribute('transform',`translate(${t.x} ${t.y}) scale(${t.k})`);}
function clampK(k){return Math.max(1,Math.min(40,k));}
function zoomAt(cx,cy,f){
  const r=svg.getBoundingClientRect(), sxu=M.w/r.width, syu=M.h/r.height;
  const mx=(cx-r.left)*sxu, my=(cy-r.top)*syu;
  const nk=clampK(t.k*f); const s=nk/t.k;
  t.x=mx-(mx-t.x)*s; t.y=my-(my-t.y)*s; t.k=nk; apply();
}
svg.addEventListener('wheel',e=>{e.preventDefault();zoomAt(e.clientX,e.clientY,e.deltaY<0?1.16:1/1.16);},{passive:false});
let drag=null;
svg.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,tx:t.x,ty:t.y};svg.classList.add('drag');svg.setPointerCapture(e.pointerId);});
svg.addEventListener('pointermove',e=>{
  if(drag){const r=svg.getBoundingClientRect();
    t.x=drag.tx+(e.clientX-drag.x)*(M.w/r.width); t.y=drag.ty+(e.clientY-drag.y)*(M.h/r.height); apply();}
});
svg.addEventListener('pointerup',e=>{drag=null;svg.classList.remove('drag');});
document.getElementById('zin').onclick=()=>{const r=svg.getBoundingClientRect();zoomAt(r.left+r.width/2,r.top+r.height/2,1.4);};
document.getElementById('zout').onclick=()=>{const r=svg.getBoundingClientRect();zoomAt(r.left+r.width/2,r.top+r.height/2,1/1.4);};
document.getElementById('reset').onclick=()=>{t={x:0,y:0,k:1};apply();};
// ---- tooltip ----
const tip=document.getElementById('tip'); let hot=null;
svg.addEventListener('pointermove',e=>{
  const el=document.elementFromPoint(e.clientX,e.clientY);
  if(el&&el.dataset&&el.dataset.code){
    if(hot!==el){if(hot)hot.classList.remove('hot');hot=el;hot.classList.add('hot');}
    const code=el.dataset.code, u=M.data[cur][code];
    tip.innerHTML=`<div class="nm">${M.names[code]||code}</div><div class="pc mono">Projected unity <b>${u.toFixed(1)}%</b></div>`;
    const st=svg.getBoundingClientRect();
    tip.style.left=(e.clientX-st.left)+'px'; tip.style.top=(e.clientY-st.top)+'px'; tip.style.opacity=1;
  } else { tip.style.opacity=0; if(hot){hot.classList.remove('hot');hot=null;} }
});
svg.addEventListener('pointerleave',()=>{tip.style.opacity=0;if(hot){hot.classList.remove('hot');hot=null;}});
paint(cur);
</script>'''

out=HTML.replace('__DATA__', DATA)
open('/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/unity_maps.html','w',encoding='utf-8').write(out)
print("wrote unity_maps.html", os.path.getsize('/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/unity_maps.html'),"bytes")
