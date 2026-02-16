"""
Compatibility wrapper for robust transfer model.
Uses the FINAL WORKING version that actually trains and improves predictions.
"""

from typing import Dict, List, Any, Optional, TYPE_CHECKING
import numpy as np
import pandas as pd
from .transfers_improved_final import RobustTransferModel, get_robust_transfer_model
from .transfers import get_transfer_model  # Original for comparison
import logging

if TYPE_CHECKING:
    from ni_votes.validation.cross_validator import Election

# Global instance of the robust model
_robust_model = None
_use_improved = True  # Toggle between original and improved

def get_transfer_model_wrapper(er_df: pd.DataFrame, tr_df: pd.DataFrame,
                               scenario_dict: Dict[str, Any],
                               progress_callback=None,
                               refit_if_changed: bool = True):
    """
    Wrapper that returns either original or robust transfer model.
    Maintains exact same API as original get_transfer_model.
    """
    global _robust_model, _use_improved
    
    if not _use_improved:
        # Fall back to original model
        return get_transfer_model(er_df, tr_df, scenario_dict, progress_callback, refit_if_changed)
    
    try:
        # Initialize robust model if needed
        if _robust_model is None:
            _robust_model = get_robust_transfer_model()
            
            # Train the model if we have training data
            if 'training_elections' in scenario_dict:
                if progress_callback:
                    progress_callback("Training robust transfer model...")
                _robust_model.fit(scenario_dict['training_elections'])
                if progress_callback:
                    progress_callback(f"✅ Robust model trained on {_robust_model.training_data_size} examples")
            else:
                # Will train lazily when needed
                pass
        
        return _robust_model
        
    except Exception as e:
        logging.error(f"Failed to create improved transfer model: {e}")
        logging.info("Falling back to original transfer model")
        _use_improved = False
        return get_transfer_model(er_df, tr_df, scenario_dict, progress_callback, refit_if_changed)


def build_training_data_from_elections(elections: List['Election']) -> List[Dict[str, Any]]:
    """
    Build training data from Election objects (used by cross-validator).
    
    Args:
        elections: List of Election objects from ni_votes.validation.cross_validator
        
    Returns:
        List of election dictionaries ready for improved transfer model training
    """
    if not elections:
        return []
    
    if hasattr(elections[0], 'election_id'):
        print(f"Building training data from {len(elections)} Election objects...")
    
    training_elections = []
    event_count = 0
    
    for election in elections:
        # Extract data from Election object
        try:
            names, parties, person_ids, first_prefs = election.get_first_prefs()
            
            if len(names) < 2:
                continue
            
            # Calculate quota
            valid_votes = sum(first_prefs)
            seats = election.seats
            quota = int(valid_votes / (seats + 1)) + 1 if seats > 0 else 1
            
            # Get transfer events (already in proper format from Election.get_transfer_events())
            transfer_events = []
            raw_events = election.get_transfer_events()
            
            for event in raw_events:
                donor_idx = event.get('donor_index', -1)
                if donor_idx < 0 or donor_idx >= len(names):
                    continue
                
                # Build event with indices instead of names
                transfer_event = {
                    'donor_index': donor_idx,
                    'donor_name': event.get('donor_name', names[donor_idx] if donor_idx < len(names) else ''),
                    'count': event.get('count', 1),
                    'recipients': event.get('recipients', {}),
                    'non_transferable': event.get('non_transferable', 0.0),
                    'quota': quota
                }
                
                transfer_events.append(transfer_event)
                event_count += 1
            
            # Build election structure
            election_data = {
                'constituency': election.constituency,
                'date': election.date,
                'seats': election.seats,
                'names': names,
                'parties': parties,
                'person_ids': person_ids,
                'first_prefs': first_prefs,
                'transfer_events': transfer_events
            }
            
            training_elections.append(election_data)
        except Exception as e:
            print(f"Warning: Could not process election {getattr(election, 'election_id', 'unknown')}: {e}")
            continue
    
    print(f"Built training data with {event_count} transfer events from {len(training_elections)} elections")
    return training_elections


def reset_robust_model():
    """Reset the global robust model instance."""
    global _robust_model
    _robust_model = None


def toggle_improved_model(use_improved: bool):
    """Toggle between original and improved transfer model."""
    global _use_improved
    _use_improved = use_improved
    if not use_improved:
        print("Using original transfer model")
    else:
        print("Using robust transfer model")