import pandas as pd
import numpy as np
import logging
from .correlations import CorrelationAnalyzer

logger = logging.getLogger(__name__)

class PCAAnalyzer:
    def __init__(self):
        self.correlation_engine = CorrelationAnalyzer()

    def compute_pca(self, mode='census_party'):
        """
        Compute PCA components.
        mode: 'census_party' (Census features vs Party Vote shares)
              'census_referendum' (Census features vs Referendum outcomes)
        """
        try:
            from sklearn.decomposition import PCA
            from sklearn.preprocessing import StandardScaler
            from sklearn.cluster import KMeans
        except ImportError:
            return {"error": "scikit-learn not installed"}

        if not self.correlation_engine.ensure_census_data():
             return {"error": "Census data unavailable"}
             
        census = self.correlation_engine.census_pivot.copy()
        
        # Drop non-numeric columns
        numeric_census = census.select_dtypes(include=[np.number])
        # Handle NaNs
        numeric_census = numeric_census.fillna(0)
        
        # 1. Standardize Census Data
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(numeric_census)
        
        # 2. Compute PCA (2 components for visualization)
        pca = PCA(n_components=2)
        principalComponents = pca.fit_transform(X_scaled)
        
        # 3. Compute K-Means Clustering (k=3 for broad demographics)
        kmeans = KMeans(n_clusters=3, random_state=42)
        clusters = kmeans.fit_predict(X_scaled)
        
        pca_df = pd.DataFrame(data = principalComponents, 
                              columns = ['PC1', 'PC2'],
                              index = numeric_census.index)
        pca_df['Cluster'] = clusters
        
        # 4. Loadings
        loadings = pd.DataFrame(pca.components_.T, columns=['PC1', 'PC2'], index=numeric_census.columns)
        
        # Get top features for PC1 and PC2
        top_pc1 = loadings['PC1'].abs().sort_values(ascending=False).head(10)
        top_pc2 = loadings['PC2'].abs().sort_values(ascending=False).head(10)
        
        # Prepare result
        points = []
        for const, row in pca_df.iterrows():
            points.append({
                "constituency": const,
                "x": float(row['PC1']),
                "y": float(row['PC2']),
                "cluster": int(row['Cluster'])
            })
            
        loading_info = {
            "PC1": [{"feature": idx, "loading": float(loadings.loc[idx, 'PC1'])} for idx in top_pc1.index],
            "PC2": [{"feature": idx, "loading": float(loadings.loc[idx, 'PC2'])} for idx in top_pc2.index]
        }
        
        return {
            "points": points,
            "loadings": loading_info,
            "explained_variance": pca.explained_variance_ratio_.tolist()
        }
