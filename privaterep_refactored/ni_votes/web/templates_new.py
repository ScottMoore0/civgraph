
PCA_BODY = r"""
<div class="card">
  <h2>Principal Component Analysis (Constituencies)</h2>
  <p>Visualizing the political landscape by reducing Census features and Party Votes to 2 dimensions.</p>
  <div id="pca-plot" style="width:100%;height:600px;"></div>
</div>
<script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
<script>
  fetch('/api/analysis/pca')
    .then(r => r.json())
    .then(data => {
      const consts = data.constituencies;
      const vectors = data.vectors;
      
      const trace1 = {
        x: consts.map(c => c.x),
        y: consts.map(c => c.y),
        text: consts.map(c => c.name),
        mode: 'markers+text',
        type: 'scatter',
        name: 'Constituencies',
        textposition: 'top center',
        marker: { size: 12, color: '#0a7cff' }
      };
      
      const layout = {
        title: 'PCA: Political & Demographic Landscape',
        xaxis: {title: 'PC1'},
        yaxis: {title: 'PC2'},
        hovermode: 'closest'
      };
      
      // Add vectors as lines (simplified)
      const shapes = vectors.map(v => ({
        type: 'line',
        x0: 0, y0: 0,
        x1: v.x * 5, y1: v.y * 5, // Scale for visibility
        line: {color: 'red', width: 2}
      }));
      
      // Add vector labels
      const trace2 = {
        x: vectors.map(v => v.x * 5.2),
        y: vectors.map(v => v.y * 5.2),
        text: vectors.map(v => v.name),
        mode: 'text',
        textfont: {color: 'red'},
        type: 'scatter',
        name: 'Features'
      };
      
      layout.shapes = shapes;
      
      Plotly.newPlot('pca-plot', [trace1, trace2], layout);
    });
</script>
"""

CORRELATION_BODY = r"""
<div class="card">
  <h2>Feature Correlations</h2>
  <label>Target:</label>
  <select id="corr-target">
    <option value="Sinn Féin">Sinn Féin Vote</option>
    <option value="DUP">DUP Vote</option>
    <option value="Alliance">Alliance Vote</option>
    <option value="remain_in_eu">Remain (EU 2016)</option>
    <option value="leave_eu">Leave (EU 2016)</option>
  </select>
  <button onclick="loadCorr()">Analyze</button>
  <div id="corr-plot" style="width:100%;height:600px;margin-top:20px;"></div>
</div>
<script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
<script>
  function loadCorr() {
    const target = document.getElementById('corr-target').value;
    fetch('/api/analysis/correlations?target=' + encodeURIComponent(target))
      .then(r => r.json())
      .then(data => {
        // Expecting data.correlations = [{feature: 'Name', value: 0.9}, ...]
        const feats = data.correlations.map(d => d.feature);
        const vals = data.correlations.map(d => d.value);
        
        const trace = {
          x: vals,
          y: feats,
          type: 'bar',
          orientation: 'h',
          marker: {
            color: vals,
            colorscale: 'RdBu',
            cmin: -1, cmax: 1
          }
        };
        
        const layout = {
          title: 'Top Correlations with ' + target,
          margin: {l: 400}, // Space for long feature names
          xaxis: {range: [-1, 1], title: 'Pearson Correlation'}
        };
        
        Plotly.newPlot('corr-plot', [trace], layout);
      });
  }
</script>
"""

NEW_REFERENDUM_BODY = r"""
<div class="card">
  <h2>Referendum Simulator (ML-Enhanced)</h2>
  <div class="grid-3">
    <div>
      <label>Date</label>
      <input type="date" id="ref-date" value="2024-07-04">
    </div>
    <div>
      <label>Target Turnout (%)</label>
      <input type="number" id="ref-turnout" value="65" min="0" max="100">
    </div>
  </div>
  
  <h3>Endorsements</h3>
  <div class="grid-4" id="endorsements-grid">
    <!-- JS will populate -->
  </div>
  
  <button onclick="runSim()" style="margin-top:20px;">Run Simulation</button>
</div>

<div id="results-area" style="display:none;">
  <div class="card">
    <h3>Results</h3>
    <div class="grid-4">
      <div class="card" style="background:#e8f5e9;text-align:center;">
        <h4>YES</h4>
        <h2 id="res-yes"></h2>
      </div>
      <div class="card" style="background:#ffebee;text-align:center;">
        <h4>NO</h4>
        <h2 id="res-no"></h2>
      </div>
      <div class="card" style="text-align:center;">
        <h4>Turnout</h4>
        <h2 id="res-turnout"></h2>
      </div>
      <div class="card" style="text-align:center;">
        <h4>Margin</h4>
        <h2 id="res-margin"></h2>
      </div>
    </div>
    <div id="const-table"></div>
  </div>
</div>

<script>
const parties = ['Sinn Féin', 'DUP', 'UUP', 'SDLP', 'Alliance', 'Green Party', 'TUV', 'People Before Profit', 'Aontú'];
const container = document.getElementById('endorsements-grid');

parties.forEach(p => {
  const div = document.createElement('div');
  div.innerHTML = `
    <label>${p}</label>
    <select class="endo-sel" data-party="${p}">
      <option value="Neutral">Neutral</option>
      <option value="Yes">Yes</option>
      <option value="No">No</option>
    </select>
  `;
  container.appendChild(div);
});

function runSim() {
  const date = document.getElementById('ref-date').value;
  const turnout = document.getElementById('ref-turnout').value;
  const endorsements = {};
  
  document.querySelectorAll('.endo-sel').forEach(sel => {
    endorsements[sel.dataset.party] = {'position': sel.value};
  });
  
  fetch('/api/simulate/referendum', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({date, turnout, endorsements})
  })
  .then(r => r.json())
  .then(data => {
    document.getElementById('results-area').style.display = 'block';
    const t = data.totals;
    const el = t.elec;
    
    const yesPct = (t.yes / el * 100).toFixed(2);
    const noPct = (t.no / el * 100).toFixed(2);
    const turnPct = (100 - (t.dnv / el * 100)).toFixed(2);
    const marginVal = Math.abs(t.yes - t.no);
    const marginPct = (marginVal / (t.yes + t.no) * 100).toFixed(2);
    
    document.getElementById('res-yes').innerText = yesPct + '%';
    document.getElementById('res-no').innerText = noPct + '%';
    document.getElementById('res-turnout').innerText = turnPct + '%';
    document.getElementById('res-margin').innerText = marginPct + '%';
    
    // Table
    let html = '<table><tr><th>Constituency</th><th>Yes %</th><th>No %</th><th>Turnout %</th></tr>';
    data.results.forEach(r => {
      const valid = 100 - r.dnv_pct; // Approx
      html += `<tr>
        <td>${r.constituency}</td>
        <td>${r.yes_pct.toFixed(1)}%</td>
        <td>${r.no_pct.toFixed(1)}%</td>
        <td>${valid.toFixed(1)}%</td>
      </tr>`;
    });
    html += '</table>';
    document.getElementById('const-table').innerHTML = html;
  });
}
</script>
"""
