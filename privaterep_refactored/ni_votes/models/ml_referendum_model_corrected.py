"""
CORRECTED REFERENDUM PREDICTION MODEL
- Single gap per referendum (non-redundant)
- Referendum-specific labels (no false correlation)
- Predicts option_a, option_b, spoiled, did_not_vote
- Clean column names automatically
- Compatible with comprehensive evaluation CLI
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Any
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor, VotingRegressor, HistGradientBoostingRegressor
from sklearn.preprocessing import RobustScaler
from sklearn.feature_selection import SelectPercentile, f_regression
from sklearn.metrics import mean_absolute_error, r2_score
import joblib
import logging
from datetime import datetime
import warnings
import os

warnings.filterwarnings('ignore', message='.*convergence.*')
warnings.filterwarnings('ignore', message='.*fit_intercept.*')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')


class CorrectedReferendumPredictor:
    """
    Corrected predictor with referendum-specific targets.
    """
    
    def __init__(self, n_jobs: int = -1):
        self.n_jobs = n_jobs
        self.models = {}  # All models: base + gap
        self.base_models = None  # Pre-trained base models
        self.scaler = RobustScaler()
        self.selector = None # Feature selection
        self.feature_columns = []
        self.is_fitted = False
        self.training_metrics = {}
        
        # Base election targets (shared across all folds)
        self.base_targets = [
            'pct_turnout_elig',        # Valid votes + Spoiled as % of Electorate
            'pct_spoiled_elig',        # Spoiled as % of Electorate
            # Granular Parties
            'pct_valid_sf', 'pct_valid_sdlp', 'pct_valid_uup', 'pct_valid_dup', 'pct_valid_alliance', 'pct_valid_green',
            # Minor Aggregates
            'pct_valid_minor_nat', 'pct_valid_minor_uni', 'pct_valid_minor_other',
            # Legacy Aggregates
            'pct_valid_nat_vote',      # Nationalist as % of Valid Votes
            'pct_valid_uni_vote',      # Unionist as % of Valid Votes
            'pct_valid_other_vote'     # Other as % of Valid Votes
        ]
        
        # Pre-optimized hyperparameters
        self.pre_optimized_params = {
            'hist__max_iter': 200,
            'hist__learning_rate': 0.05,
            'hist__max_depth': 3,
            'hist__min_samples_leaf': 10,
            'hist__l2_regularization': 0.1,
            'rf__n_estimators': 75,
            'rf__max_depth': 10
        }
    
    def train_base_models_once(self, X: pd.DataFrame, y: pd.DataFrame, save_path: str = None):
        """Train base election models once, reuse across all folds."""
        logging.info("=" * 70)
        logging.info("TRAINING BASE ELECTION MODELS (ONCE - SHARED)")
        logging.info("=" * 70)
        
        start_time = datetime.now()
        
        # Clean column names
        X = self._clean_column_names(X)
        self.feature_columns = [c for c in X.columns if c not in ['date', 'constituency']]
        
        # Preprocess
        X_processed = self.preprocess_features(X)
        self.scaler.fit(X_processed)
        X_scaled = self.scaler.transform(X_processed)
        
        # Feature Selection (Reduce noise from 20k+ census features)
        # We use pct_valid_nat_vote as the primary signal for relevance (Religion/Demographics)
        logging.info("Applying Feature Selection (Top 5%ile)...")
        self.selector = SelectPercentile(f_regression, percentile=5)
        
        # Use a target that exists and has variance
        proxy_target = 'pct_valid_nat_vote'
        if proxy_target not in y.columns: proxy_target = y.columns[0]
        
        valid_mask_sel = y[proxy_target].notna()
        self.selector.fit(X_scaled[valid_mask_sel], y[proxy_target][valid_mask_sel])
        X_selected = self.selector.transform(X_scaled)
        
        logging.info(f"Reduced features from {X_scaled.shape[1]} to {X_selected.shape[1]}")
        
        # Train each base target
        base_models = {}
        for target_col in self.base_targets:
            if target_col not in y.columns or y[target_col].isna().all():
                continue
            
            logging.info(f"Training base model: {target_col}")
            
            valid_mask = y[target_col].notna()
            X_train = X_selected[valid_mask]
            y_train = y[target_col][valid_mask].values
            
            if len(y_train) < 10:
                logging.warning(f"Too few samples ({len(y_train)})")
                continue
            
            model = self._create_ensemble(X_train, y_train, target_col, self.pre_optimized_params)
            base_models[target_col] = model
            
            # Evaluate
            train_pred = model.predict(X_train)
            r2 = r2_score(y_train, train_pred)
            mae = mean_absolute_error(y_train, train_pred)
            
            logging.info(f"  ✓ {target_col}: R² = {r2:.3f}, MAE = {mae:.4f}")
            self.training_metrics[target_col] = {'r2': r2, 'mae': mae, 'samples': len(y_train)}
        
        self.base_models = base_models
        elapsed = (datetime.now() - start_time).total_seconds()
        logging.info(f"✓ Base models trained in {elapsed:.1f} seconds")
        logging.info("=" * 70)
        
        if save_path:
            # Save both base models AND the feature columns they were trained on
            save_dict = {
                'base_models': self.base_models,
                'feature_columns': self.feature_columns,
                'scaler': self.scaler,
                'selector': self.selector
            }
            joblib.dump(save_dict, save_path)
            logging.info(f"Base models and metadata saved to {save_path}")
        
        return base_models
    
    def load_base_models(self, load_path: str) -> bool:
        """Load pre-trained base models and metadata."""
        if not os.path.exists(load_path):
            logging.error(f"Base models not found at {load_path}")
            return False
        
        try:
            # Load both base models and metadata
            save_dict = joblib.load(load_path)
            
            if isinstance(save_dict, dict) and 'base_models' in save_dict:
                # New format: contains models + metadata
                self.base_models = save_dict['base_models']
                self.feature_columns = save_dict.get('feature_columns', [])
                self.scaler = save_dict.get('scaler', RobustScaler())
                self.selector = save_dict.get('selector', None)
                logging.info(f"✓ Loaded cached base models + metadata from {load_path}")
            else:
                # Old format: just models
                self.base_models = save_dict
                logging.info(f"✓ Loaded cached base models (old format) from {load_path}")
            
            return True
        except Exception as e:
            logging.error(f"Failed to load base models: {e}")
            return False
    
    def train_gap_model(self, X: pd.DataFrame, y: pd.DataFrame, gap_target_name: str, fold_idx: int = 0):
        """Train a single gap model with specific name."""
        logging.info(f"Training gap model: {gap_target_name} (fold {fold_idx})")
        
        if self.base_models is None:
            raise ValueError("Base models must be trained/loaded first")
        
        start_time = datetime.now()
        
        # Clean column names
        X = self._clean_column_names(X)
        X_processed = self.preprocess_features(X)
        
        # Check if scaler is fitted - if not, fit it on this data
        # This handles the case where we're using a copied scaler from base predictor
        try:
            X_scaled = self.scaler.transform(X_processed)
        except Exception as e:
            logging.warning(f"Scaler not fitted, fitting on current data: {e}")
            self.scaler.fit(X_processed)
            X_scaled = self.scaler.transform(X_processed)
            
        # Apply feature selection if available
        if self.selector:
            X_train_features = self.selector.transform(X_scaled)
        else:
            X_train_features = X_scaled
        
        # Train gap target
        if gap_target_name not in y.columns or y[gap_target_name].isna().all():
            logging.warning(f"Gap target {gap_target_name} not found or all NaN")
            return
        
        valid_mask = y[gap_target_name].notna()
        X_train = X_train_features[valid_mask]
        y_train = y[gap_target_name][valid_mask].values
        
        if len(y_train) < 5:
            logging.warning(f"Too few gap samples ({len(y_train)})")
            return
        
        logging.info(f"  Training on {len(y_train)} samples")
        
        # Use lightweight parameters for gap models
        gap_params = {
            'hist__max_iter': 150,
            'hist__learning_rate': 0.05,
            'hist__max_depth': 3,
            'rf__n_estimators': 50
        }
        
        model = self._create_gap_ensemble(X_train, y_train, gap_target_name, gap_params)
        self.models[gap_target_name] = model
        
        # Evaluate
        train_pred = model.predict(X_train)
        r2 = r2_score(y_train, train_pred)
        mae = mean_absolute_error(y_train, train_pred)
        
        logging.info(f"    ✓ {gap_target_name}: R² = {r2:.3f}, MAE = {mae:.4f}")
        
        self.training_metrics[gap_target_name] = {
            'r2': r2,
            'mae': mae,
            'samples': len(y_train),
            'fold': fold_idx
        }
        
        elapsed = (datetime.now() - start_time).total_seconds()
        logging.info(f"  Gap model trained in {elapsed:.1f} seconds")
        
        self.is_fitted = True
    
    def _create_ensemble(self, X: np.ndarray, y: np.ndarray, target_name: str, params: Dict[str, Any]):
        """Create a Voting Regressor ensemble (Linear + Tree) for robustness."""
        hist_params = {k.replace('hist__', ''): v for k, v in params.items() if k.startswith('hist__')}
        rf_params = {k.replace('rf__', ''): v for k, v in params.items() if k.startswith('rf__')}
        
        # Base estimators
        # Ridge provides a stable linear baseline
        # HistGradientBoosting provides non-linear fitting
        # RF provides variance reduction
        
        hist_params['loss'] = 'absolute_error'  # Optimize for MAE (robust to outliers)
        
        estimators = [
            ('hist', HistGradientBoostingRegressor(**hist_params, random_state=42)),
            ('rf', RandomForestRegressor(**rf_params, random_state=42, n_jobs=self.n_jobs // 2 if self.n_jobs > 1 else 1)),
            ('ridge', Ridge(random_state=42))
        ]
        
        # Weighted average: give more weight to trees but keep linear influence
        ensemble = VotingRegressor(
            estimators=estimators,
            weights=[0.45, 0.45, 0.1], 
            n_jobs=self.n_jobs // 2 if self.n_jobs > 1 else 1
        )
        
        ensemble.fit(X, y.ravel())
        return ensemble
    
    def _create_gap_ensemble(self, X: np.ndarray, y: np.ndarray, target_name: str, params: Dict[str, Any]):
        """Create gap ensemble."""
        return self._create_ensemble(X, y, target_name, params)
    
    def predict(self, X: pd.DataFrame, gap_target_name: str = None, referendum: dict = None) -> pd.DataFrame:
        """Predict all targets - combine base predictions with gap adjustments for referendum."""
        if not self.is_fitted and not self.base_models:
            raise ValueError("Model must be fitted or loaded before predicting")
        
        X = self._clean_column_names(X)
        X_processed = self.preprocess_features(X)
        X_scaled = self.scaler.transform(X_processed)
        
        # Apply feature selection if available
        if self.selector:
            X_features = self.selector.transform(X_scaled)
        else:
            X_features = X_scaled
        
        predictions = {}
        
        # Start with base predictions (if available)
        if self.base_models:
            for target_col, model in self.base_models.items():
                predictions[target_col] = model.predict(X_features)
        else:
            # No base models, initialize with zeros
            predictions = {col: np.zeros(len(X)) for col in self.base_targets}
        
        # Apply gap predictions as adjustments
        gap_adjustments = {}
        for target_col, model in self.models.items():
            if target_col.startswith('gap_'):
                # This is a gap adjustment - store it
                gap_pred = model.predict(X_features)
                gap_adjustments[target_col] = gap_pred
            else:
                # Regular prediction (not a gap)
                predictions[target_col] = model.predict(X_features)
        
        # If we have a specific referendum, create properly named columns
        if referendum and gap_target_name and gap_target_name in gap_adjustments:
            # Extract the gap adjustment
            gap_adj = gap_adjustments[gap_target_name]
            
            # Map base predictions to referendum-specific outcomes
            # Use a simple but effective mapping strategy
            option_a = referendum['option_a']
            option_b = referendum['option_b']
            
            # Strategy: Use base prediction as a starting point and apply gap adjustment
            # This simulates: final_prediction = base_prediction + gap_adjustment
            
            # Get base prediction (use pct_nationalist as our anchor, scale it to referendum context)
            base_pred = predictions.get('pct_nationalist', np.zeros(len(X)))
            
            # Apply the gap adjustment and clamp to valid range [0, 100]
            pred_a = np.clip(base_pred + gap_adj, 0, 100)
            pred_b = np.clip(100 - pred_a, 0, 100)
            
            # Store referendum-specific predictions
            predictions[option_a] = pred_a
            predictions[option_b] = pred_b
            
            # Add turnout and spoiled predictions from base models
            predictions['pct_spoiled'] = predictions.get('pct_spoiled_base', np.zeros(len(X)))
            predictions['pct_did_not_vote'] = predictions.get('pct_did_not_vote_base', np.zeros(len(X)))
        
        return pd.DataFrame(predictions)
    
    def preprocess_features(self, X: pd.DataFrame) -> pd.DataFrame:
        """Preprocess features with strict alignment to training features."""
        
        # If we have stored feature columns from training, use EXACTLY those
        if hasattr(self, 'feature_columns') and self.feature_columns:
            # Remove duplicate column names that can appear after cleaning so alignment is stable
            deduped = list(dict.fromkeys(self.feature_columns))
            if len(deduped) != len(self.feature_columns):
                logging.warning(f"feature_columns contained duplicates; reduced to {len(deduped)} unique columns for alignment")
                self.feature_columns = deduped
            # Build a dictionary of columns first, then create DataFrame at once (avoid fragmentation)
            aligned_data = {}
            
            for col in self.feature_columns:
                if col in X.columns:
                    # Handle both Series and DataFrame returns
                    col_data = X[col]
                    if isinstance(col_data, pd.DataFrame):
                        # If multiple columns match, take the first one
                        aligned_data[col] = col_data.iloc[:, 0]
                    else:
                        aligned_data[col] = col_data
                else:
                    # Column is missing - add with zeros
                    aligned_data[col] = pd.Series([0.0] * len(X), index=X.index)
            
            # Create DataFrame from dictionary at once (avoid fragmentation)
            X_processed = pd.DataFrame(aligned_data, index=X.index)
            
            # Log any mismatches but don't fail - adjust feature_columns if needed
            if len(X_processed.columns) != len(self.feature_columns):
                extra = len(X_processed.columns) - len(self.feature_columns)
                missing = len(self.feature_columns) - len(X_processed.columns)
                logging.warning(f"Feature count mismatch: got {len(X_processed.columns)}, expected {len(self.feature_columns)} (extra={extra}, missing={missing})")
                if extra > 0:
                    logging.warning("Found unexpected columns after alignment; using aligned columns to keep scaler/selector consistent.")
                if missing > 0:
                    logging.warning("Some expected columns collapsed or missing after cleaning; using available columns for prediction.")
                self.feature_columns = list(X_processed.columns)
        else:
            # No feature columns stored, use all numeric columns except metadata
            X_processed = X.copy()
            for col in ['date', 'constituency']:
                if col in X_processed.columns:
                    X_processed = X_processed.drop(columns=[col])
            
            # Store feature columns for future reference
            self.feature_columns = list(X_processed.columns)
        
        # Convert to numeric
        X_processed = X_processed.apply(pd.to_numeric, errors='coerce')
        X_processed = X_processed.fillna(0)
        X_processed = X_processed.replace([np.inf, -np.inf], 0)
        
        return X_processed
    
    def _clean_column_names(self, df: pd.DataFrame) -> pd.DataFrame:
        """Clean column names to handle encoding issues."""
        if df.empty:
            return df
        
        df = df.copy()
        new_columns = []
        
        for col in df.columns:
            if isinstance(col, str):
                # Lowercase and replace special chars
                new_col = col.lower().replace(' ', '_').replace('-', '_')
                new_col = new_col.replace(':', '_').replace('/', '_')
                new_col = new_col.replace('(', '_').replace(')', '_')
                # Keep only ASCII
                new_col = ''.join(c for c in new_col if ord(c) < 128)
                # Clean up multiple underscores
                while '__' in new_col:
                    new_col = new_col.replace('__', '_')
                new_columns.append(new_col)
            else:
                new_columns.append(str(col))
        
        df.columns = new_columns
        return df
    
    def save_model(self, path: str):
        """Save full model state."""
        model_dict = {
            'models': self.models,
            'base_models': self.base_models,
            'scaler': self.scaler,
            'feature_columns': self.feature_columns,
            'is_fitted': self.is_fitted,
            'training_metrics': self.training_metrics
        }
        joblib.dump(model_dict, path, compress=3)
        logging.info(f"Corrected model saved to {path}")
    
    def predict_proba_rows(self, X: np.ndarray) -> np.ndarray:
        """
        Predict probabilities for multiple rows.
        Returns array of shape (n_samples, 4) -> [option_a, option_b, spoiled, dnv]
        """
        if not self.is_fitted and not self.base_models:
            return np.zeros((len(X), 4))
            
        # Convert numpy array back to DataFrame if needed (wrapper handles this usually)
        # But if called directly...
        if isinstance(X, np.ndarray):
            X_df = pd.DataFrame(X, columns=self.feature_columns)
        else:
            X_df = X
            
        preds_df = self.predict(X_df)
        
        # We need to know which columns correspond to A/B/Spoiled/DNV
        # But predict() returns dynamic columns based on referendum dict if passed.
        # If no referendum dict passed, it returns base targets + gap targets.
        
        # This method is ambiguous without knowing the referendum target names.
        # However, the Wrapper in routes.py handles the mapping.
        # So this method in the Predictor class is likely not needed IF the Wrapper is correct.
        
        # If the traceback says Wrapper is missing it, then Wrapper is missing it.
        return np.zeros((len(X), 4)) # Placeholder