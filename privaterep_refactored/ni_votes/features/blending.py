"""Performance-weighted blending for hierarchical transfer models."""

from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd
from sklearn.metrics import log_loss


class ModelBlender:
    """Performance-weighted blending for multiple model levels."""
    
    def __init__(self, k_n: float = 50.0, beta_loss: float = 2.0, epsilon: float = 1e-6):
        """Initialize blender with hyperparameters."""
        self.k_n = k_n  # Scale for sample size factor
        self.beta_loss = beta_loss  # Penalty for worse-performing levels
        self.epsilon = epsilon  # Prevent division by zero
        self.level_performance = {}  # Store cross-validated performance metrics
        
    def compute_sample_size_factor(self, n_context: int) -> float:
        """Compute sample size factor: n / (n + k_n)."""
        return n_context / (n_context + self.k_n)
    
    def compute_performance_factor(self, loss: float) -> float:
        """Compute performance factor: exp(-beta_loss * loss)."""
        return np.exp(-self.beta_loss * loss)
    
    def compute_blending_weights(
        self, 
        context_stats: Dict[str, Dict[str, float]],
        level_losses: Optional[Dict[str, float]] = None
    ) -> Dict[str, float]:
        """Compute blending weights for each model level."""
        
        weights = {}
        raw_weights = {}
        
        for level, stats in context_stats.items():
            n_context = stats.get('n_context', 0)
            loss = level_losses.get(level, 1.0) if level_losses else 1.0
            
            # Sample size factor
            f_n = self.compute_sample_size_factor(n_context)
            
            # Performance factor
            f_perf = self.compute_performance_factor(loss)
            
            # Raw weight
            raw_weight = (f_n * f_perf) + self.epsilon
            raw_weights[level] = raw_weight
        
        # Normalize weights
        total_weight = sum(raw_weights.values())
        if total_weight > 0:
            for level, raw_weight in raw_weights.items():
                weights[level] = raw_weight / total_weight
        else:
            # Equal weights if all are zero
            n_levels = len(raw_weights)
            for level in raw_weights:
                weights[level] = 1.0 / n_levels
        
        return weights
    
    def blend_probabilities(
        self,
        level_probabilities: Dict[str, np.ndarray],
        weights: Dict[str, float]
    ) -> np.ndarray:
        """Blend probability vectors from multiple levels."""
        
        if not level_probabilities:
            return np.array([])
        
        # Get the shape from the first probability vector
        first_key = next(iter(level_probabilities.keys()))
        shape = level_probabilities[first_key].shape
        
        # Initialize blended result
        blended = np.zeros(shape)
        
        for level, prob_vector in level_probabilities.items():
            weight = weights.get(level, 0.0)
            if weight > 0:
                blended += weight * prob_vector
        
        return blended
    
    def evaluate_level_performance(
        self,
        level_predictions: Dict[str, np.ndarray],
        true_labels: np.ndarray,
        sample_weights: Optional[np.ndarray] = None
    ) -> Dict[str, float]:
        """Evaluate performance of each model level on validation data."""
        
        losses = {}
        
        for level, predictions in level_predictions.items():
            if predictions.shape[0] != true_labels.shape[0]:
                continue
                
            try:
                # Use log loss as performance metric
                loss = log_loss(true_labels, predictions, sample_weight=sample_weights)
                losses[level] = loss
            except Exception:
                # Default to high loss if calculation fails
                losses[level] = 10.0
        
        return losses
    
    def get_context_stats(self, pairs_df: pd.DataFrame, level_column: str = "level") -> Dict[str, Dict[str, float]]:
        """Get context statistics for each model level."""
        
        stats = {}
        
        for level, group in pairs_df.groupby(level_column):
            stats[level] = {
                'n_context': len(group),
                'total_ballots': float(group.get('weight', 1.0).sum()),
                'unique_donors': group.get('donor_party', pd.Series()).nunique(),
                'unique_recipients': group.get('recipient_party', pd.Series()).nunique()
            }
        
        return stats