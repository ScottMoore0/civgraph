"""
REFERENDUM SIMULATOR MODEL
Generates constituency-level projections for referendum results based on party endorsements and
historical party vote shares. Works for any binary referendum option framework.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Any
import logging

class ReferendumModel:
    """Base class for referendum projection models."""
    
    def __init__(self):
        self.is_fitted = False
        self.endorsements = {}
        logging.info("ReferendumModel initialized")
    
    def load_endorsements(self, xl: pd.ExcelFile) -> Dict[str, str]:
        """Load party endorsements from Endorsements sheet."""
        try:
            endorsements_df = xl.parse('Endorsements')
            endorsements = dict(zip(endorsements_df['Party Name'], 
                                   endorsements_df['Referendum Option']))
            logging.info(f"Loaded {len(endorsements)} endorsements")
            return endorsements
        except Exception as e:
            logging.warning(f"Could not load endorsements: {e}")
            return {}
    
    def fit(self, historical_data: List[Dict[str, Any]]) -> None:
        """Train model on historical referendum data."""
        logging.info(f"Training on {len(historical_data)} historical examples")
        self.is_fitted = True
    
    def predict(self, constituencies: List[str], party_shares: Dict[str, Dict[str, float]]) -> Dict[str, Dict[str, float]]:
        """Generate projections for constituencies."""
        raise NotImplementedError("Subclasses must implement predict")

class SimpleEndorsementModel(ReferendumModel):
    """Simple model: option votes = sum of endorsing party vote shares with impact factor."""
    
    def __init__(self, impact_factor: float = 1.2):
        super().__init__()
        self.impact_factor = impact_factor
    
    def predict(self, constituencies: List[str], party_shares: Dict[str, Dict[str, float]]) -> Dict[str, Dict[str, float]]:
        """Project referendum results based on party vote shares."""
        if not self.is_fitted:
            raise ValueError("Model must be fitted first")
        
        results = {}
        
        for constituency in constituencies:
            shares = party_shares.get(constituency, {})
            if not shares:
                continue
            
            option_scores = {}
            
            for party, vote_share in shares.items():
                if party in self.endorsements:
                    option = self.endorsements[party]
                    weighted_share = vote_share * self.impact_factor
                    option_scores[option] = option_scores.get(option, 0) + weighted_share
            
            total = sum(option_scores.values()) or 1.0
            results[constituency] = {opt: score/total for opt, score in option_scores.items()}
        
        return results

def create_brexit_endorsements():
    """Create party endorsements for Brexit-style referendum."""
    return {
        'DUP': 'Leave', 'UUP': 'Leave', 'TUV': 'Leave',
        'Sinn Féin': 'Remain', 'SDLP': 'Remain', 'Alliance': 'Remain',
        'Green Party': 'Remain', 'People Before Profit': 'Remain'
    }

def create_protocol_endorsements():
    """Create party endorsements for NI Protocol consent vote."""
    return {
        'DUP': 'Reject', 'UUP': 'Reject', 'TUV': 'Reject',
        'Sinn Féin': 'Accept', 'SDLP': 'Accept', 'Alliance': 'Accept',
        'Green Party': 'Accept', 'People Before Profit': 'Reject'
    }