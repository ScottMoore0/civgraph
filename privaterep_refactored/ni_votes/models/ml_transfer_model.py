import pandas as pd
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.preprocessing import OrdinalEncoder
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

class MLTransferPredictor:
    def __init__(self):
        self.model = None
        self.categorical_cols = ['SourceParty', 'DestParty', 'Constituency']
        self.numeric_cols = ['Count', 'SourceVotes', 'Quota', 'NumCandidates']
        
    def prepare_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """Prepare raw election data for transfer prediction."""
        # We need rows where a transfer happens.
        # Source: Candidate eliminated or surplus distributed.
        # Dest: Candidate receiving votes.
        # Value: Number of votes / Percentage of source bundle.
        
        # This requires processing the 'ElectionResults' sheet into distinct transfer events.
        # A transfer event connects a Source Candidate (Party) to a Dest Candidate (Party).
        
        # Simplified extraction for now:
        # We assume input 'df' is already somewhat structured or we parse 'Transfers' column.
        # If we parse raw data, we need logic similar to adjusted_transfers.
        
        # For this implementation, assuming we have a structured dataset or build it.
        # Let's assume we build it from the raw 'Full election tables.xlsx'.
        pass 

    def train(self, X, y):
        """Train the model."""
        # Pipeline handling categorical encoding natively (HGBR supports it if encoded as integers)
        # But OrdinalEncoder is safer pipeline.
        
        cat_preprocessor = OrdinalEncoder(handle_unknown='use_encoded_value', unknown_value=-1)
        
        preprocessor = ColumnTransformer([
            ('cat', cat_preprocessor, self.categorical_cols),
            ('num', 'passthrough', self.numeric_cols)
        ])
        
        self.model = Pipeline([
            ('preprocessor', preprocessor),
            ('regressor', HistGradientBoostingRegressor(
                max_iter=200,
                learning_rate=0.1,
                max_depth=10,
                random_state=42,
                categorical_features=[0, 1, 2] # Indices of cat cols after preprocessing? No, before.
                # HGBR handles categories if we pass them properly. 
                # Sklearn 1.0+ HGBR supports categorical_features='from_dtype' or boolean mask.
                # OrdinalEncoder output is float/int.
            ))
        ])
        
        self.model.fit(X, y)
        return self

    def predict(self, X):
        return self.model.predict(X)

    def evaluate(self, X, y, groups=None):
        """Evaluate using Leave-One-Group-Out (e.g. Group=ElectionDate)."""
        if groups is None:
            # Simple CV
            pass
        else:
            gkf = GroupKFold(n_splits=5)
            scores = []
            for train_idx, test_idx in gkf.split(X, y, groups):
                X_train, y_train = X.iloc[train_idx], y.iloc[train_idx]
                X_test, y_test = X.iloc[test_idx], y.iloc[test_idx]
                
                self.model.fit(X_train, y_train)
                preds = self.model.predict(X_test)
                
                # Clip predictions to 0-100%
                preds = np.clip(preds, 0, 100)
                
                mae = mean_absolute_error(y_test, preds)
                rmse = np.sqrt(mean_squared_error(y_test, preds))
                scores.append({'mae': mae, 'rmse': rmse})
                
            return pd.DataFrame(scores).mean()
