from flask import Blueprint, render_template_string, request, jsonify, current_app
import pandas as pd
import json
from ..analysis.correlations import CorrelationAnalyzer
from ..analysis.pca import PCAAnalyzer
from ..analysis.trends import TrendAnalyzer
from ..web.data_access import CFG_ER_DF
from ..features.transfers_enhanced_robust import get_robust_transfer_model

analysis_bp = Blueprint('analysis', __name__)

ANALYSIS_LAYOUT = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NI Votes - Analysis</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body { padding-top: 20px; background-color: #f8f9fa; }
        .card { margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .nav-link.active { font-weight: bold; color: #0d6efd; }
        .section-header { margin-bottom: 20px; border-bottom: 1px solid #dee2e6; padding-bottom: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <header class="d-flex flex-wrap justify-content-center py-3 mb-4 border-bottom">
            <a href="/" class="d-flex align-items-center mb-3 mb-md-0 me-md-auto text-dark text-decoration-none">
                <span class="fs-4">NI Votes Analysis</span>
            </a>
            <ul class="nav nav-pills">
                <li class="nav-item"><a href="/" class="nav-link">Home</a></li>
                <li class="nav-item"><a href="/analysis/view" class="nav-link active">Analysis Dashboard</a></li>
            </ul>
        </header>

        <div class="row">
            <div class="col-md-3">
                <div class="list-group">
                    <button class="list-group-item list-group-item-action active" id="nav-trends" onclick="showSection('trends')">Vote Trends</button>
                    <button class="list-group-item list-group-item-action" id="nav-corr-ref" onclick="showSection('corr-ref')">Referendum Correlations</button>
                    <button class="list-group-item list-group-item-action" id="nav-corr-party" onclick="showSection('corr-party')">Party Correlations</button>
                    <button class="list-group-item list-group-item-action" id="nav-pca" onclick="showSection('pca')">PCA Visualization</button>
                    <button class="list-group-item list-group-item-action" id="nav-importance" onclick="showSection('importance')">Model Insights</button>
                </div>
            </div>
            <div class="col-md-9">
                
                <!-- Trends Section -->
                <div id="section-trends" class="analysis-section">
                    <div class="card">
                        <div class="card-body">
                            <h5 class="card-title">Party Vote Trends</h5>
                            <p class="text-muted">Historical vote share performance over time.</p>
                            <div class="input-group mb-3">
                                <select id="trend-party-select" class="form-select">
                                    <option value="Sinn Féin">Sinn Féin</option>
                                    <option value="DUP">DUP</option>
                                    <option value="UUP">UUP</option>
                                    <option value="SDLP">SDLP</option>
                                    <option value="Alliance">Alliance</option>
                                    <option value="Green">Green Party</option>
                                    <option value="TUV">TUV</option>
                                    <option value="PBP">People Before Profit</option>
                                </select>
                                <button class="btn btn-primary" onclick="loadTrends()">Plot Trend</button>
                            </div>
                            <div id="trend-plot" style="width:100%;height:500px;"></div>
                        </div>
                    </div>
                </div>

                <!-- Referendum Section -->
                <div id="section-corr-ref" class="analysis-section" style="display:none;">
                    <div class="card">
                        <div class="card-body">
                            <h5 class="card-title">Referendum Correlations</h5>
                            <p class="text-muted">Analyze correlations between Census features and Referendum options.</p>
                            <div class="input-group mb-3">
                                <input type="text" id="ref-input" class="form-control" placeholder="e.g. EU 2016, Good Friday" value="EU 2016">
                                <button class="btn btn-primary" onclick="loadRefCorrelations()">Analyze</button>
                            </div>
                            <div id="ref-results"></div>
                        </div>
                    </div>
                </div>

                <!-- Party Section -->
                <div id="section-corr-party" class="analysis-section" style="display:none;">
                    <div class="card">
                        <div class="card-body">
                            <h5 class="card-title">Party Correlations</h5>
                            <p class="text-muted">Analyze correlations between Census features and Party vote shares (post-1995).</p>
                            <div class="input-group mb-3">
                                <select id="party-select" class="form-select">
                                    <option value="Sinn Féin">Sinn Féin</option>
                                    <option value="DUP">DUP</option>
                                    <option value="UUP">UUP</option>
                                    <option value="SDLP">SDLP</option>
                                    <option value="Alliance">Alliance</option>
                                    <option value="Green">Green Party</option>
                                    <option value="TUV">TUV</option>
                                    <option value="PBP">People Before Profit</option>
                                </select>
                                <button class="btn btn-primary" onclick="loadPartyCorrelations()">Analyze</button>
                            </div>
                            <div id="party-results"></div>
                        </div>
                    </div>
                </div>

                <!-- PCA Section -->
                <div id="section-pca" class="analysis-section" style="display:none;">
                    <div class="card">
                        <div class="card-body">
                            <h5 class="card-title">PCA Analysis</h5>
                            <p class="text-muted">Principal Component Analysis of Constituencies based on Census Data.</p>
                            <button class="btn btn-primary mb-3" onclick="loadPCA()">Generate PCA</button>
                            <div id="pca-plot" style="width:100%;height:500px;"></div>
                            <div id="pca-loadings" class="mt-3"></div>
                        </div>
                    </div>
                </div>

                <!-- Model Importance Section -->
                <div id="section-importance" class="analysis-section" style="display:none;">
                    <div class="card">
                        <div class="card-body">
                            <h5 class="card-title">Transfer Model Feature Importance</h5>
                            <p class="text-muted">What drives vote transfers? Top features from the Random Forest model.</p>
                            <button class="btn btn-primary mb-3" onclick="loadImportance()">Load Importance</button>
                            <div id="importance-plot" style="width:100%;height:600px;"></div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>

    <script>
        function showSection(id) {
            document.querySelectorAll('.analysis-section').forEach(el => el.style.display = 'none');
            document.getElementById('section-' + id).style.display = 'block';
            document.querySelectorAll('.list-group-item').forEach(el => el.classList.remove('active'));
            document.getElementById('nav-' + id).classList.add('active');
        }

        async function loadTrends() {
            const party = document.getElementById('trend-party-select').value;
            const div = document.getElementById('trend-plot');
            div.innerHTML = '<div class="spinner-border" role="status"></div> Loading...';
            
            try {
                const res = await fetch('/analysis/api/trends?party=' + encodeURIComponent(party));
                const data = await res.json();
                
                if (data.error) {
                    div.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
                    return;
                }
                
                const history = data.history;
                const trace = {
                    x: history.map(h => h.date),
                    y: history.map(h => h.share),
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: data.party,
                    line: {shape: 'spline'}
                };
                
                const layout = {
                    title: `${data.party} Vote Share Over Time`,
                    xaxis: { title: 'Date' },
                    yaxis: { title: 'Vote Share (%)' }
                };
                
                div.innerHTML = '';
                Plotly.newPlot('trend-plot', [trace], layout);
                
            } catch (e) {
                div.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
            }
        }

        async function loadRefCorrelations() {
            const refName = document.getElementById('ref-input').value;
            const div = document.getElementById('ref-results');
            div.innerHTML = '<div class="spinner-border" role="status"></div> Loading...';
            
            try {
                const res = await fetch('/analysis/api/correlations/referendum?name=' + encodeURIComponent(refName));
                const data = await res.json();
                
                if (data.error) {
                    div.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
                    return;
                }
                
                let html = '';
                for (const [option, corrs] of Object.entries(data)) {
                    html += `<h6>${option}</h6><table class="table table-sm table-striped"><thead><tr><th>Feature</th><th>Correlation</th></tr></thead><tbody>`;
                    corrs.forEach(c => {
                        html += `<tr><td>${c.feature}</td><td>${c.correlation.toFixed(4)}</td></tr>`;
                    });
                    html += '</tbody></table>';
                }
                div.innerHTML = html;
            } catch (e) {
                div.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
            }
        }

        async function loadPartyCorrelations() {
            const party = document.getElementById('party-select').value;
            const div = document.getElementById('party-results');
            div.innerHTML = '<div class="spinner-border" role="status"></div> Loading...';
            
            try {
                const res = await fetch('/analysis/api/correlations/party?name=' + encodeURIComponent(party));
                const data = await res.json();
                
                if (data.error) {
                    div.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
                    return;
                }
                
                let html = `<h6>Top Correlations for ${data.party}</h6><table class="table table-sm table-striped"><thead><tr><th>Feature</th><th>Correlation</th></tr></thead><tbody>`;
                data.correlations.forEach(c => {
                    html += `<tr><td>${c.feature}</td><td>${c.correlation.toFixed(4)}</td></tr>`;
                });
                html += '</tbody></table>';
                div.innerHTML = html;
            } catch (e) {
                div.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
            }
        }

        async function loadPCA() {
            const div = document.getElementById('pca-plot');
            div.innerHTML = '<div class="spinner-border" role="status"></div> Loading...';
            
            try {
                const res = await fetch('/analysis/api/pca');
                const data = await res.json();
                
                if (data.error) {
                    div.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
                    return;
                }
                
                div.innerHTML = '';
                
                // Group by Cluster for coloring
                const clusters = {};
                data.points.forEach(p => {
                    const c = p.cluster;
                    if (!clusters[c]) clusters[c] = { x: [], y: [], text: [] };
                    clusters[c].x.push(p.x);
                    clusters[c].y.push(p.y);
                    clusters[c].text.push(p.constituency);
                });
                
                const traces = [];
                Object.keys(clusters).forEach(c => {
                    traces.push({
                        x: clusters[c].x,
                        y: clusters[c].y,
                        text: clusters[c].text,
                        mode: 'markers+text',
                        type: 'scatter',
                        textposition: 'top center',
                        marker: { size: 12 },
                        name: `Cluster ${c}`
                    });
                });
                
                const layout = {
                    title: 'Census PCA Map (Clustered)',
                    xaxis: { title: `PC1 (${(data.explained_variance[0]*100).toFixed(1)}%)` },
                    yaxis: { title: `PC2 (${(data.explained_variance[1]*100).toFixed(1)}%)` }
                };
                
                Plotly.newPlot('pca-plot', traces, layout);
                
                // Loadings
                let loadHtml = '<div class="row"><div class="col-md-6"><h6>PC1 Drivers</h6><ul>';
                data.loadings.PC1.forEach(l => loadHtml += `<li>${l.feature} (${l.loading.toFixed(3)})</li>`);
                loadHtml += '</ul></div><div class="col-md-6"><h6>PC2 Drivers</h6><ul>';
                data.loadings.PC2.forEach(l => loadHtml += `<li>${l.feature} (${l.loading.toFixed(3)})</li>`);
                loadHtml += '</ul></div></div>';
                
                document.getElementById('pca-loadings').innerHTML = loadHtml;
                
            } catch (e) {
                div.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
            }
        }

        async function loadImportance() {
            const div = document.getElementById('importance-plot');
            div.innerHTML = '<div class="spinner-border" role="status"></div> Loading...';
            
            try {
                const res = await fetch('/analysis/api/importance');
                const data = await res.json();
                
                if (data.error) {
                    div.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
                    return;
                }
                
                div.innerHTML = '';
                
                const trace = {
                    x: data.features.map(f => f.importance),
                    y: data.features.map(f => f.name),
                    type: 'bar',
                    orientation: 'h'
                };
                
                const layout = {
                    title: 'Transfer Model Feature Importance',
                    yaxis: { automargin: true },
                    xaxis: { title: 'Importance Score' },
                    margin: { l: 150 }
                };
                
                Plotly.newPlot('importance-plot', [trace], layout);
                
            } catch (e) {
                div.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`;
            }
        }
    </script>
</body>
</html>
"""

def init_analysis_routes(app):
    @analysis_bp.route('/view')
    def analysis_view():
        return render_template_string(ANALYSIS_LAYOUT)

    @analysis_bp.route('/api/correlations/referendum')
    def api_corr_ref():
        name = request.args.get('name', 'EU')
        # Use global ER_DF if available
        er_df = current_app.config.get(CFG_ER_DF)
        analyzer = CorrelationAnalyzer()
        # Inject data manually since CorrelationAnalyzer loads from file by default
        if er_df is not None:
            analyzer.er_df = er_df
            
        results = analyzer.get_referendum_correlations(name)
        return jsonify(results)

    @analysis_bp.route('/api/correlations/party')
    def api_corr_party():
        name = request.args.get('name', 'Sinn Féin')
        er_df = current_app.config.get(CFG_ER_DF)
        analyzer = CorrelationAnalyzer()
        if er_df is not None:
            analyzer.er_df = er_df
            
        results = analyzer.get_party_correlations(name)
        return jsonify(results)

    @analysis_bp.route('/api/pca')
    def api_pca():
        pca = PCAAnalyzer()
        results = pca.compute_pca()
        return jsonify(results)

    @analysis_bp.route('/api/trends')
    def api_trends():
        party = request.args.get('party', 'Sinn Féin')
        er_df = current_app.config.get(CFG_ER_DF)
        analyzer = TrendAnalyzer(er_df)
        results = analyzer.get_party_vote_history(party)
        return jsonify(results)

    @analysis_bp.route('/api/importance')
    def api_importance():
        try:
            from ..features.transfers_enhanced_robust import get_robust_transfer_model
            
            model = get_robust_transfer_model()
            
            # Try to load model if not fitted
            if not model.is_fitted:
                import os
                if os.path.exists("robust_transfer_model.joblib"):
                    model.load_model("robust_transfer_model.joblib")
            
            # Check if we can load feature importances
            if hasattr(model, 'feature_names') and model.feature_names and hasattr(model.model, 'feature_importances_'):
                importances = model.model.feature_importances_
                features = [{"name": n, "importance": float(i)} for n, i in zip(model.feature_names, importances)]
                features.sort(key=lambda x: x['importance'], reverse=True) # Descending
                features = features[:20] # Top 20
                features.reverse() # For bar chart
                return jsonify({"features": features})
            else:
                return jsonify({"error": "Model not trained yet. Run a simulation first."})
        except Exception as e:
            return jsonify({"error": str(e)})

    app.register_blueprint(analysis_bp, url_prefix='/analysis')
