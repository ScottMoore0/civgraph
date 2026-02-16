"""
ROBUST TRANSFER MODEL - Simplified but effective version
Uses a single RandomForest model with comprehensive features
Faster to train, more reliable, and avoids complex 2-stage issues
"""

import logging
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Tuple
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler, LabelEncoder
import warnings
warnings.filterwarnings('ignore')


class RobustTransferModel:
    """
    Enhanced single-stage transfer prediction model using RandomForest.
    
    Improvements over base model:
    - Party-pair interaction features (top 20 party combinations)
    - Pre-optimized feature extraction with integer encoding
    - Maintains simplicity while adding key political context
    
    Benefits:
    - Handles transfer patterns specific to party relationships
    - Faster to train with optimized feature extraction
    - More accurate by capturing tribal vs cross-community dynamics
    """
    
    def __init__(self, n_estimators: int = 150, max_depth: int = 12):
        # Reduced n_estimators for faster training (diminishing returns after 100-150)
        self.model = RandomForestRegressor(
            n_estimators=n_estimators,
            max_depth=max_depth,
            min_samples_split=5,
            min_samples_leaf=5,
            max_features='sqrt',
            n_jobs=-1,
            random_state=42
        )
        self.scaler = StandardScaler()
        self.is_fitted = False
        
        # Feature encoders
        self.donor_party_encoder = LabelEncoder()
        self.survivor_party_encoder = LabelEncoder()
        self.body_encoder = LabelEncoder()
        
        # Party-pair encoding: pre-computed mapping of top party pairs
        self.party_pair_mapping = {}
        self.top_party_pairs = [
            # Core unionist bloc transfers
            ("DUP", "UUP"),
            ("UUP", "DUP"),
            ("DUP", "TUV"),
            ("TUV", "DUP"),
            ("UUP", "TUV"),
            ("TUV", "UUP"),
            # Core nationalist bloc transfers  
            ("Sinn Féin", "SDLP"),
            ("SDLP", "Sinn Féin"),
            ("Sinn Féin", "Aontú"),
            ("Aontú", "Sinn Féin"),
            ("SDLP", "Aontú"),
            ("Aontú", "SDLP"),
            # Cross-community patterns
            ("Alliance", "Green Party"),
            ("Green Party", "Alliance"),
            ("Alliance", "Independent"),
            ("Independent", "Alliance"),
            ("Alliance", "SDLP"),
            ("SDLP", "Alliance"),
            ("UUP", "Alliance"),
            ("Sinn Féin", "Alliance"),  # Rare but interesting
            ("People's Alliance", "Alliance"),
        ]
        
        # Feature names (expanded with party-pair features)
        self.feature_names = None
        
    def _extract_features(self, 
                         donor_idx: int, 
                         survivor_idx_input: Any,
                         election_context: Dict[str, Any],
                         count_context: Dict[str, Any]) -> np.ndarray:
        """Extract comprehensive features for transfer prediction with party-pair interactions. Vectorized."""
        
        names = election_context.get('names', [])
        parties = election_context.get('parties', [])
        first_prefs = election_context.get('first_prefs', [])
        current_votes = count_context.get('current_votes', first_prefs)
        
        n_candidates = len(names)
        if n_candidates == 0:
            return np.zeros((1, 45)) if isinstance(survivor_idx_input, (list, np.ndarray)) else np.zeros(45)
        
        # Convert inputs to arrays
        if isinstance(survivor_idx_input, (int, np.integer)):
            survivor_indices = np.array([survivor_idx_input])
        else:
            survivor_indices = np.array(survivor_idx_input)
            
        N = len(survivor_indices)
        donor_idx = min(donor_idx, n_candidates - 1)
        survivor_indices = np.clip(survivor_indices, 0, n_candidates - 1)
        
        # --- Shared Context (Scalars) ---
        quota_val = float(count_context.get('quota', 8000))
        current_votes_array = np.array(current_votes, dtype=float)
        first_prefs_array = np.array(first_prefs, dtype=float)
        
        total_votes = np.sum(current_votes_array)
        seats_filled = int(np.sum(current_votes_array >= quota_val))
        survival_rate = float(np.sum(current_votes_array > 0)) / max(1, len(current_votes_array))
        active_rate = float(np.sum(current_votes_array > 0)) / max(1, len(current_votes_array))
        
        # Donor Stats
        donor_votes = current_votes_array[donor_idx]
        donor_first = first_prefs_array[donor_idx]
        donor_party = parties[donor_idx] if donor_idx < len(parties) else "Unknown"
        donor_norm = donor_first / max(1, np.max(first_prefs_array)) if len(first_prefs_array) > 0 else 0
        donor_ind = 1.0 if donor_party == "Independent" else 0.0
        donor_quota = donor_votes / max(1, quota_val)
        count_num = float(count_context.get('count_number', 1))
        
        # --- Vectorized Survivor Stats ---
        survivor_votes = current_votes_array[survivor_indices]
        survivor_first = first_prefs_array[survivor_indices]
        
        survivor_growth = np.zeros(N)
        mask = survivor_first > 0
        survivor_growth[mask] = survivor_votes[mask] / survivor_first[mask]
        
        survivor_parties = [parties[i] if i < len(parties) else "Unknown" for i in survivor_indices]
        survivor_parties = np.array(survivor_parties)
        
        same_party = (survivor_parties == donor_party).astype(float)
        survivor_ind = (survivor_parties == "Independent").astype(float)
        survivor_quota = survivor_votes / max(1, quota_val)
        avg_votes = float(np.mean(current_votes_array))
        
        # --- Context Vector ---
        total_quota_ratio = total_votes / max(1, quota_val)
        total_seats = float(count_context.get('total_seats', 5))
        
        vote_gap = np.abs(donor_votes - survivor_votes) / max(1, quota_val)
        first_gap = np.abs(donor_first - survivor_first) / max(1, np.max(first_prefs_array)) if len(first_prefs_array) > 0 else np.zeros(N)
        
        # --- Party Pairs Vectorization ---
        # Pre-compute pair matches
        pair_features = np.zeros((N, 20))
        for i, (dp, sp) in enumerate(self.top_party_pairs[:20]):
            # If donor matches first part, check survivors against second part
            if donor_party == dp:
                pair_features[:, i] = (survivor_parties == sp).astype(float)
            elif donor_party == sp: # Check symmetry if pairs are bidirectional in logic? No, ordered.
                # The pairs list handles both directions (A,B) and (B,A) explicitly.
                pass
                
        # Assemble Matrix (N x 45)
        # Donor (8)
        f_donor = np.column_stack([
            np.full(N, donor_votes), np.full(N, donor_first), np.full(N, donor_norm), 
            np.full(N, count_num), np.full(N, donor_ind), np.full(N, seats_filled),
            np.full(N, survival_rate), np.full(N, donor_quota)
        ])
        
        # Survivor (8)
        f_survivor = np.column_stack([
            survivor_votes, survivor_first, survivor_growth, np.full(N, count_num),
            same_party, survivor_ind, np.full(N, avg_votes), survivor_quota
        ])
        
        # Context (9)
        f_context = np.column_stack([
            np.full(N, quota_val), np.full(N, total_votes), np.full(N, total_quota_ratio),
            np.full(N, seats_filled), np.full(N, total_seats), np.full(N, count_num),
            vote_gap, first_gap, np.full(N, active_rate)
        ])
        
        features = np.hstack([f_donor, f_survivor, f_context, pair_features])
        
        if isinstance(survivor_idx_input, (int, np.integer)):
            return features[0]
        return features
    
    def fit(self, training_elections: List[Dict[str, Any]]) -> None:
        """Train the robust model on transfer events."""
        logging.info(f"Training robust transfer model on {len(training_elections)} elections...")
        
        X = []
        y = []
        total_events = 0
        
        for election in training_elections:
            if 'transfer_events' not in election:
                continue
            
            election_context = {
                'names': election['names'],
                'parties': election['parties'],
                'first_prefs': election['first_prefs']
            }
            
            for event in election['transfer_events']:
                # Get donor index
                donor_idx = event.get('donor_index', -1)
                if donor_idx == -1:
                    donor_name = event.get('donor_name', '')
                    if donor_name and donor_name in election['names']:
                        donor_idx = election['names'].index(donor_name)
                    else:
                        donor_idx = 0 
                
                count_context = {
                    'count_number': event.get('count', 1),
                    'current_votes': event.get('current_votes', election['first_prefs']),
                    'quota': event.get('quota', 8000),
                    'seats_filled': sum(1 for v in event.get('current_votes', election['first_prefs']) if v > event.get('quota', 8000)),
                    'total_seats': election['seats'],
                    'previous_votes': election['first_prefs']
                }
                
                # Positive Examples
                recipients = []
                amounts = []
                for r_name, amt in event['recipients'].items():
                    if r_name in election['names']:
                        recipients.append(election['names'].index(r_name))
                        amounts.append(float(amt))
                
                if recipients:
                    feats = self._extract_features(donor_idx, recipients, election_context, count_context)
                    # feats is (N, 45)
                    for i in range(len(recipients)):
                        X.append(feats[i])
                        y.append(amounts[i])
                        total_events += 1
                
                # Negative Examples (Sample a few)
                negatives = []
                if event['non_transferable'] > 0:
                    candidates = [i for i,n in enumerate(election['names']) 
                                 if n not in event['recipients'] and i != donor_idx]
                    # Limit negatives to balance
                    if len(candidates) > 3:
                        import random
                        candidates = random.sample(candidates, 3)
                    
                    if candidates:
                        feats_neg = self._extract_features(donor_idx, candidates, election_context, count_context)
                        for i in range(len(candidates)):
                            X.append(feats_neg[i])
                            y.append(0.0)
                            total_events += 1
        
        if total_events == 0:
            logging.error("No training events found! Model cannot be trained.")
            return
        
        logging.info(f"Collected {total_events} training examples")
        
        X = np.array(X)
        y = np.array(y)
        
        if len(X) < 10:
            self.model = RandomForestRegressor(n_estimators=50, max_depth=5, random_state=42)
        
        self.scaler.fit(X)
        X_scaled = self.scaler.transform(X)
        self.model.fit(X_scaled, y)
        self.is_fitted = True
        
        # Feature importance (same as before)
        if hasattr(self.model, 'feature_importances_'):
            base_features = [
                'donor_votes', 'donor_first', 'donor_norm', 'count_num', 'donor_ind', 
                'seats_filled', 'survival_rate', 'donor_quota',
                'survivor_votes', 'survivor_first', 'survivor_growth', 'count_num2', 
                'same_party', 'survivor_ind', 'avg_votes', 'survivor_quota',
                'quota', 'total_votes', 'total_quota_ratio', 'seats_filled2', 
                'total_seats', 'count_num3', 'vote_gap', 'first_gap', 'active_rate'
            ]
            pair_features = [f"pair_{d}_{s}" for d, s in self.top_party_pairs[:20]]
            self.feature_names = base_features + pair_features
            
            importance = list(zip(self.feature_names, self.model.feature_importances_))
            importance.sort(key=lambda x: x[1], reverse=True)
            logging.info("Top features:")
            for name, imp in importance[:10]:
                logging.info(f"  {name}: {imp:.3f}")
    
    def predict(self, elim_idx: int, surv_idx: int, 
                election_context: Dict[str, Any],
                count_context: Dict[str, Any]) -> float:
        """Legacy single prediction (wrapper)."""
        if not self.is_fitted: return 0.0
        # Use vectorized call
        f = self._extract_features(elim_idx, [surv_idx], election_context, count_context)
        fs = self.scaler.transform(f)
        return max(0.0, float(self.model.predict(fs)[0]))
    
    def expect_proba(self, elim_idx: int, surv_idx: np.ndarray,
                    ctx: Dict[str, Any]) -> np.ndarray:
        """Interface expected by STV engine. Batch optimized."""
        
        if surv_idx is None or len(surv_idx) == 0:
            return np.array([])
        
        # Extract context
        names = ctx.get('names', [])
        parties = ctx.get('parties', ctx.get('party', []))
        first_prefs = ctx.get('initial_first', ctx.get('first_prefs', []))
        quotas = ctx.get('quota', 8000)
        if isinstance(quotas, (list, np.ndarray)): quota = float(quotas[0]) if len(quotas) > 0 else 8000.0
        else: quota = float(quotas)
        
        count_context = {
            'count_number': ctx.get('count', 1),
            'current_votes': ctx.get('current_votes', first_prefs),
            'quota': quota,
            'total_seats': ctx.get('total_seats', 5)
        }
        election_context = {'names': names, 'parties': parties, 'first_prefs': first_prefs}
        
        # Filter out self
        valid_survivors = [idx for idx in surv_idx if idx != elim_idx]
        if not valid_survivors:
            return np.zeros(len(surv_idx))
            
        # Fully Vectorized Extraction & Prediction
        X_batch = self._extract_features(elim_idx, valid_survivors, election_context, count_context)
        
        if not self.is_fitted:
            return np.zeros(len(surv_idx))
            
        X_scaled = self.scaler.transform(X_batch)
        predictions = self.model.predict(X_scaled)
        
        # Map back
        probabilities = np.zeros(len(surv_idx))
        pred_map = {idx: val for idx, val in zip(valid_survivors, predictions)}
        
        for i, s_idx in enumerate(surv_idx):
            probabilities[i] = max(0.0, float(pred_map.get(s_idx, 0.0)))
        
        return np.array(probabilities, dtype=np.float64)
    
    def expect_proba_with_nt(self, elim_idx: int, surv_idx: np.ndarray,
                            ctx: Dict[str, Any]) -> Tuple[np.ndarray, float]:
        """Enhanced interface that also returns non-transferable probability."""
        
        probabilities = self.expect_proba(elim_idx, surv_idx, ctx)
        
        # Calculate p_nt based on expected vs actual transfer patterns
        # In NI elections, 10-25% of votes typically become non-transferable
        total_prob = np.sum(probabilities)
        donor_votes = ctx.get('current_votes', [0])[elim_idx] if elim_idx < len(ctx.get('current_votes', [])) else 0
        
        if donor_votes > 0:
            # If model predicts less than expected, the remainder is NT
            expected_preserved = 0.85  # Assume 85% of votes are transferable on average
            p_nt = max(0.05, min(0.30, 1.0 - total_prob / max(1, donor_votes)))
        else:
            p_nt = 0.15  # Default reasonable NT rate
        
        return np.array(probabilities, dtype=np.float64), p_nt

    def save_model(self, path: str) -> None:
        """Save model to disk."""
        import joblib
        joblib.dump({
            'model': self.model,
            'scaler': self.scaler,
            'is_fitted': self.is_fitted,
            'feature_names': self.feature_names
        }, path)
        logging.info(f"Model saved to {path}")

    def load_model(self, path: str) -> bool:
        """Load model from disk."""
        import joblib
        import os
        if not os.path.exists(path):
            return False
        try:
            data = joblib.load(path)
            self.model = data['model']
            self.scaler = data['scaler']
            self.is_fitted = data['is_fitted']
            self.feature_names = data.get('feature_names')
            logging.info(f"Model loaded from {path}")
            return True
        except Exception as e:
            logging.error(f"Failed to load model: {e}")
            return False


def get_enhanced_transfer_model() -> RobustTransferModel:
    """Factory function."""
    return RobustTransferModel()


def get_robust_transfer_model() -> RobustTransferModel:
    """Alias for consistency."""
    return RobustTransferModel()