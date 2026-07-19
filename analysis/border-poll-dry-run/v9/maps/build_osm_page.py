import json
GEO=open('/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/dz_geo.json',encoding='utf-8').read()
STATS={r['date']:r for r in json.load(open('/home/user/civgraph/analysis/border-poll-dry-run/v9/summary_output.json'))['results']}
LABEL={'2021-01':'Jan 2021','2022-08':'Aug 2022','2024-02':'Feb 2024','2025-02':'Feb 2025'}

HTML=r'''<title>Projected Irish Unity Referendum — Data Zone maps (OSM)</title>
<style>__LEAFCSS__</style>
<script>__LEAFJS__</script>
<style>
:root{--panel:rgba(20,26,34,.9);--ink:#eef1f5;--muted:#9aa6b4;--faint:#6b7686;--line:#2b333f;--accent:#3f9e63;}
*{box-sizing:border-box}
html,body{margin:0;height:100%;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
#map{position:absolute;inset:0;background:#aadaff}
.hud{position:absolute;z-index:1000;color:var(--ink)}
.top{top:12px;left:52px;right:12px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;pointer-events:none}
.card{background:var(--panel);backdrop-filter:blur(8px);border:1px solid var(--line);border-radius:12px;
  box-shadow:0 6px 24px rgba(0,0,0,.3);pointer-events:auto}
.title{padding:11px 15px;margin-right:auto}
.title h1{font-size:14.5px;margin:0 0 2px;font-weight:640}
.title p{font-size:11px;margin:0;color:var(--muted)}
.title p b{color:var(--ink)}
.tabs{display:flex;gap:3px;padding:5px}
.tab{appearance:none;border:0;background:transparent;color:var(--muted);cursor:pointer;font:inherit;
  font-size:11.5px;font-weight:560;padding:6px 11px;border-radius:8px;display:flex;flex-direction:column;align-items:center;gap:1px}
.tab .v{font-weight:700;font-size:12px}.tab .l{font-size:9px;letter-spacing:.08em;text-transform:uppercase}
.tab[aria-selected=true]{background:#0e1218;color:var(--ink)}
.tab:hover{color:var(--ink)}.tab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ctl{padding:11px 14px;display:flex;flex-direction:column;gap:9px;min-width:190px}
.ctl .row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--muted)}
.ctl input[type=range]{width:100%;accent-color:var(--accent)}
.cap{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.readout{bottom:26px;left:12px;padding:12px 14px;min-width:180px}
.readout .big .n{font-size:28px;font-weight:700}.readout .big .u{font-size:13px;color:var(--muted)}
.readout .band{font-size:11px;color:var(--muted);margin-top:2px}
.readout .r2{display:flex;gap:16px;margin-top:9px;padding-top:9px;border-top:1px solid var(--line)}
.readout .r2 .k{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint)}
.readout .r2 .v{font-size:13px;font-weight:620}
.legend{bottom:26px;right:12px;padding:10px 13px;width:236px}
.legend .cap{margin-bottom:7px}
.bar{height:10px;border-radius:3px;position:relative;
  background:linear-gradient(90deg,#08306b,#2166ac 26%,#7fb0d6 44%,#eee6d5 50%,#8fca9a 58%,#1f8a4c 76%,#0b5228)}
.bar .thr{position:absolute;left:50%;top:-3px;bottom:-3px;width:2px;background:#fff;transform:translateX(-1px)}
.ticks{display:flex;justify-content:space-between;margin-top:4px;font-size:9.5px;color:var(--muted)}
.thrl{margin-top:6px;font-size:10px;color:var(--muted)}
.leaflet-tooltip.dz{background:#0e1218;border:1px solid var(--line);color:var(--ink);font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.4)}
.leaflet-tooltip.dz b{color:#fff}
@media (max-width:640px){.ctl,.legend{min-width:0;width:170px}.title{width:100%}}
</style>

<div id="map"></div>
<div class="hud top">
  <div class="card title">
    <h1>Projected Irish Unity Referendum &mdash; Northern Ireland</h1>
    <p>Data Zone projection &middot; <b>% voting United Ireland</b> in a Border Poll &middot; OpenStreetMap basemap</p>
  </div>
  <div class="card tabs" role="tablist" id="tabs"></div>
  <div class="card ctl">
    <div class="cap">Layer opacity</div>
    <input type="range" id="op" min="0" max="100" value="80" aria-label="Polygon opacity"/>
    <div class="row"><span>Transparent</span><span class="mono" id="opv">80%</span></div>
  </div>
</div>
<div class="hud card readout" id="readout"></div>
<div class="hud card legend">
  <div class="cap">Projected unity vote</div>
  <div class="bar"><div class="thr"></div></div>
  <div class="ticks mono"><span>15</span><span>30</span><span>50</span><span>70</span><span>85%</span></div>
  <div class="thrl">White line = 50%, the Border-Poll threshold</div>
</div>

<script>window.GEO=__GEO__; window.STATS=__STATS__; window.LABEL=__LABEL__;</script>
<script>
const GEO=window.GEO, DATES=GEO.dates; let cur=DATES[DATES.length-1], op=0.8;
const STOPS=[[15,'#08306b'],[30,'#2166ac'],[42,'#7fb0d6'],[50,'#eee6d5'],[58,'#8fca9a'],[70,'#1f8a4c'],[85,'#0b5228']];
const hx=c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
const SP=STOPS.map(s=>[s[0],hx(s[1])]);
function colour(u){ if(u==null)return '#777';
  if(u<=SP[0][0])return STOPS[0][1]; if(u>=SP[SP.length-1][0])return STOPS[SP.length-1][1];
  for(let i=0;i<SP.length-1;i++){const[a,ca]=SP[i],[b,cb]=SP[i+1];
    if(u>=a&&u<=b){const t=(u-a)/(b-a),r=ca.map((v,j)=>Math.round(v+(cb[j]-v)*t));
      return'#'+r.map(v=>v.toString(16).padStart(2,'0')).join('');}}}

const map=L.map('map',{preferCanvas:true,zoomControl:true}).setView([54.64,-6.68],8);
L.control.zoom({position:'topleft'}); map.zoomControl.setPosition('topleft');
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19, attribution:'&copy; OpenStreetMap contributors'}).addTo(map);

function style(f){const u=f.properties.u[cur]; return {color:'#00000022',weight:.5,fillColor:colour(u),fillOpacity:op};}
const layer=L.geoJSON(GEO,{style,renderer:L.canvas(),
  onEachFeature:(f,l)=>{
    l.bindTooltip(()=>`<div><b>${f.properties.n}</b></div><div>Projected unity <b class="mono">${(f.properties.u[cur]??0).toFixed(1)}%</b></div>`,
      {className:'dz',sticky:true});
    l.on('mouseover',()=>l.setStyle({weight:1.6,color:'#fff'}));
    l.on('mouseout',()=>l.setStyle({weight:.5,color:'#00000022'}));
  }}).addTo(map);
map.fitBounds(layer.getBounds(),{padding:[20,20]});

function repaint(){layer.setStyle(style);}
function readout(){const s=window.STATS[cur];document.getElementById('readout').innerHTML=
  `<div class="cap">NI &mdash; projected unity (${window.LABEL[cur]})</div>
   <div class="big"><span class="n mono">${s.output_ni.toFixed(1)}</span><span class="u">%</span></div>
   <div class="band mono">band ${s.output_low.toFixed(1)}&ndash;${s.output_high.toFixed(1)}% &middot; LT ${s.input_lucidtalk} / NILT ${s.input_nilt}</div>
   <div class="r2"><div><div class="k">Maj-unity DZs</div><div class="v mono">${s.maj.toFixed(1)}%</div></div>
     <div><div class="k">Median DZ</div><div class="v mono">${s.dz_med.toFixed(1)}%</div></div></div>`;}
const tabsEl=document.getElementById('tabs');
DATES.forEach((d,i)=>{const b=document.createElement('button');b.className='tab';b.setAttribute('role','tab');
  b.setAttribute('aria-selected',d===cur);b.tabIndex=d===cur?0:-1;
  b.innerHTML=`<span class="l">${window.LABEL[d]}</span><span class="v mono">${window.STATS[d].output_ni.toFixed(1)}%</span>`;
  b.onclick=()=>{cur=d;[...tabsEl.children].forEach((c,j)=>{c.setAttribute('aria-selected',DATES[j]===d);c.tabIndex=DATES[j]===d?0:-1;});repaint();readout();};
  b.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();
    const n=(i+(e.key==='ArrowRight'?1:DATES.length-1))%DATES.length;tabsEl.children[n].click();tabsEl.children[n].focus();}};
  tabsEl.appendChild(b);});
const opEl=document.getElementById('op');
opEl.oninput=()=>{op=opEl.value/100;document.getElementById('opv').textContent=opEl.value+'%';repaint();};
readout();
</script>'''

LEAFCSS=open('/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/leaflet.css',encoding='utf-8').read()
LEAFJS=open('/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/leaflet.js',encoding='utf-8').read()
HTML=HTML.replace('__LEAFCSS__',LEAFCSS).replace('__LEAFJS__',LEAFJS)
out=HTML.replace('__GEO__',GEO).replace('__STATS__',json.dumps(STATS)).replace('__LABEL__',json.dumps(LABEL))
open('/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/unity_maps_osm.html','w',encoding='utf-8').write(out)
import os;print("wrote unity_maps_osm.html %.1f MB"%(os.path.getsize('/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad/unity_maps_osm.html')/1e6))
