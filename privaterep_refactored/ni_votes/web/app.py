from __future__ import annotations
from flask import Flask
from .data_access import init_data
from .routes import init_routes
from .routes_analysis import init_analysis_routes

# Import performance optimizations
try:
    from ..performance_config import configure_performance_optimizations
    configure_performance_optimizations()
except Exception:
    pass  # Performance optimizations are optional

def create_app() -> Flask:
    app = Flask(__name__)
    init_data(app)      # load workbook + caches into app.config
    init_routes(app)    # register routes
    try:
        init_analysis_routes(app)  # register analysis blueprint
    except Exception:
        pass  # Analysis routes are optional (may have missing dependencies)
    
    # Initialize scenario result cache
    app._scenario_cache = {}
    
    return app

# Allow: python -m ni_votes.web.app
if __name__ == "__main__":
    app = create_app()
    import os, webbrowser
    port = int(os.environ.get("PORT", 5000))
    url = f"http://127.0.0.1:{port}/"
    try:
        webbrowser.open_new_tab(url)
    except Exception:
        pass
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
