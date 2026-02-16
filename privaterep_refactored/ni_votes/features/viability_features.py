"""Viability features for STV transfer modeling."""

from typing import Dict, List, Optional, Any
import numpy as np
import pandas as pd


def calculate_viability_features(
    tallies: np.ndarray,
    parties: List[str],
    quota: float,
    count_number: int,
    total_counts: int,
    alive_mask: Optional[np.ndarray] = None
) -> Dict[str, Any]:
    """Calculate viability features for all candidates in an STV count."""
    
    if alive_mask is None:
        alive_mask = np.ones(len(tallies), dtype=bool)
    
    # Only consider alive candidates
    alive_tallies = tallies[alive_mask]
    alive_parties = [parties[i] for i in range(len(parties)) if alive_mask[i]]
    
    if len(alive_tallies) == 0:
        return {}
    
    # Sort by current tally (descending)
    sorted_indices = np.argsort(alive_tallies)[::-1]
    sorted_tallies = alive_tallies[sorted_indices]
    sorted_parties = [alive_parties[i] for i in sorted_indices]
    
    # Basic viability metrics
    total_remaining = float(np.sum(alive_tallies))
    max_tally = float(np.max(alive_tallies))
    min_tally = float(np.min(alive_tallies))
    
    # Calculate features for each candidate
    viability_features = {}
    
    for i, (tally, party) in enumerate(zip(alive_tallies, alive_parties)):
        original_idx = np.where(alive_mask)[0][i] if alive_mask is not None else i
        
        # Basic viability
        rank = int(np.sum(alive_tallies > tally)) + 1  # 1-based rank
        viability_score = float(tally / max_tally) if max_tally > 0 else 0.0
        
        # Front/back markers
        is_front_runner = 1 if rank <= 3 else 0  # Top 3
        is_back_marker = 1 if rank >= len(alive_tallies) - 2 else 0  # Bottom 3
        
        # Quota-related
        distance_from_quota = float(quota - tally) if quota > 0 else 0.0
        relative_strength = float(tally / total_remaining) if total_remaining > 0 else 0.0
        
        # Within-bloc ranking (would need bloc mapping)
        # For now, we'll calculate this in the main feature engineering
        
        # Progress indicator
        count_progress_ratio = float(count_number / total_counts) if total_counts > 0 else 0.0
        
        # Store features for this candidate
        candidate_key = f"candidate_{original_idx}"
        viability_features[candidate_key] = {
            'recipient_viability_rank': rank,
            'recipient_viability_score': viability_score,
            'recipient_is_front_runner': is_front_runner,
            'recipient_is_back_marker': is_back_marker,
            'recipient_distance_from_quota': distance_from_quota,
            'recipient_relative_strength': relative_strength,
            'count_progress_ratio': count_progress_ratio
        }
    
    return viability_features


def get_viability_context_features(
    donor_idx: int,
    surv_idx: np.ndarray,
    tallies: np.ndarray,
    parties: List[str],
    quota: float,
    count_number: int,
    total_counts: int,
    political_mapper: Any,
    date_str: Optional[str] = None
) -> Dict[str, float]:
    """Get viability features for a specific transfer context."""
    
    features = {}
    
    if len(surv_idx) == 0:
        return features
    
    # Get donor info
    donor_tally = float(tallies[donor_idx]) if donor_idx < len(tallies) else 0.0
    donor_party = parties[donor_idx] if donor_idx < len(parties) else ""
    
    # Get survivor info
    survivor_tallies = tallies[surv_idx]
    survivor_parties = [parties[i] for i in surv_idx]
    
    if len(survivor_tallies) == 0:
        return features
    
    # Basic viability metrics
    total_survivors = float(np.sum(survivor_tallies))
    max_survivor_tally = float(np.max(survivor_tallies))
    
    # Donor surplus ratio (if this is a surplus transfer)
    if quota > 0 and donor_tally > quota:
        features['donor_surplus_ratio'] = float((donor_tally - quota) / quota)
    else:
        features['donor_surplus_ratio'] = 0.0
    
    # For each survivor, calculate their features
    for i, (survivor_idx, survivor_tally, survivor_party) in enumerate(zip(surv_idx, survivor_tallies, survivor_parties)):
        # Basic viability
        rank = int(np.sum(survivor_tallies > survivor_tally)) + 1
        viability_score = float(survivor_tally / max_survivor_tally) if max_survivor_tally > 0 else 0.0
        
        # Front/back markers
        is_front_runner = 1 if rank <= 3 else 0
        is_back_marker = 1 if rank >= len(survivor_tallies) - 2 else 0
        
        # Quota and relative strength
        distance_from_quota = float(quota - survivor_tally) if quota > 0 else 0.0
        relative_strength = float(survivor_tally / total_survivors) if total_survivors > 0 else 0.0
        
        # Within-bloc ranking (using political mapper)
        survivor_bloc = political_mapper.map_party(survivor_party, date_str)['bloc']
        same_bloc_indices = [j for j, party in enumerate(survivor_parties) 
                           if political_mapper.map_party(party, date_str)['bloc'] == survivor_bloc]
        within_bloc_rank = int(np.sum([survivor_tallies[j] > survivor_tally for j in same_bloc_indices])) + 1
        
        # Is this the only remaining candidate of their bloc?
        is_only_remaining_of_bloc = 1 if len(same_bloc_indices) == 1 else 0
        
        # Store features for this recipient
        suffix = f"_{i}" if len(surv_idx) > 1 else ""
        features[f'recipient_viability_rank{suffix}'] = rank
        features[f'recipient_viability_score{suffix}'] = viability_score
        features[f'recipient_is_front_runner{suffix}'] = is_front_runner
        features[f'recipient_is_back_marker{suffix}'] = is_back_marker
        features[f'recipient_distance_from_quota{suffix}'] = distance_from_quota
        features[f'recipient_relative_strength{suffix}'] = relative_strength
        features[f'recipient_within_bloc_rank{suffix}'] = within_bloc_rank
        features[f'recipient_is_only_remaining_of_bloc{suffix}'] = is_only_remaining_of_bloc
    
    # Overall context features
    features['count_progress_ratio'] = float(count_number / total_counts) if total_counts > 0 else 0.0
    
    return features