"""
REFERENDUM MODEL - Web App Integration

Provides the _NNReferendumWrapper class that the web app expects,
wrapping our SimpleEndorsementModel for referendum projections.
"""

import logging
from typing import Dict, List, Any

logging.basicConfig(level=logging.INFO, format='%(message)s')


class _NNReferendumWrapper:
    """
    Web app integration wrapper for the SimpleEndorsementModel.
    
    Provides the interface that the web application expects while
    using our working SimpleEndorsementModel under the hood.
    """
    
    def __init__(self, model_type: str = "simple"):
        """Initialize with the appropriate referendum model."""
        logging.info("Initializing Simple Endorsement Model for web app...")
        
        # Import here to avoid circular imports
        from .models.referendum_model import SimpleEndorsementModel, create_brexit_endorsements, create_protocol_endorsements
        
        self.model = SimpleEndorsementModel(impact_factor=1.2)
        self.model_type = model_type
        self.endorsements = {}
        
        # SAFER: Always create _is_fitted attribute first
        object.__setattr__(self, '_is_fitted', False)
        
        if model_type == "brexit":
            self.endorsements = create_brexit_endorsements()
            logging.info("Configured for Brexit referendum (Leave/Remain)")
        elif model_type == "protocol":
            self.endorsements = create_protocol_endorsements()
            logging.info("Configured for NI Protocol vote (Accept/Reject)")
        else:
            logging.info("Configured for custom referendum - no endorsements set")
        
        self.model.endorsements = self.endorsements
        self.model.fit([])
        object.__setattr__(self, '_is_fitted', True)  # Use object.__setattr__ to bypass any overrides
        
        logging.info("[OK] Referendum model ready for web app integration")
    
    @property
    def is_fitted(self) -> bool:
        """Property to safely access fitted status."""
        return getattr(self, '_is_fitted', False)
    
    @is_fitted.setter
    def is_fitted(self, value: bool):
        """Safely set fitted status."""
        self._is_fitted = value
    
    def set_endorsements(self, endorsements: Dict[str, str]) -> None:
        """Update party endorsements for the referendum."""
        self.endorsements = endorsements
        self.model.endorsements = endorsements
        logging.info(f"Updated endorsements for {len(endorsements)} parties")
    
    def fit(self, training_data=None):
        """Compatibility method - simple model doesn't need training."""
        self._is_fitted = True
        logging.info("Model fit complete (no training needed)")
    
    def __getattr__(self, name: str):
        """
        Fallback to ensure _is_fitted is always accessible.
        This handles cases where the web app or serialization might 
        try to access attributes that don't exist.
        """
        if name == '_is_fitted':
            # Always return False if _is_fitted doesn't exist
            return False
        
        # For any other missing attribute, raise proper error
        raise AttributeError(f"'{self.__class__.__name__}' object has no attribute '{name}'")
    
    def predict(self, constituencies: List[str], party_shares: Dict[str, Dict[str, float]], **kwargs) -> Dict[str, Dict[str, float]]:
        """Generate referendum projections."""
        return self.model.predict(constituencies, party_shares)
    
    def predict_from_workbook(self, xl, election_date: str, **kwargs) -> Dict:
        """Predict directly from Excel workbook for web app."""
        from .data.loading import load_election_results
        import pandas as pd
        
        try:
            er_df = load_election_results(xl)
            er_df['name_date'] = er_df['Constituency'] + '_' + er_df['DateStr']
            
            election_data = er_df[
                (er_df['DateStr'] == election_date) & 
                (er_df['ResultType'] == 'Candidate') &
                (er_df['Votes1'] > 0)
            ].copy()
            
            party_shares = {}
            constituencies = []
            
            for const in election_data['Constituency'].unique():
                const_data = election_data[election_data['Constituency'] == const]
                total_votes = const_data['Votes1'].sum()
                
                if total_votes == 0:
                    continue
                
                shares = {}
                for party, votes in const_data.groupby('Party Name')['Votes1'].sum().items():
                    shares[party] = float(votes) / float(total_votes)
                
                key = f"{const}_{election_date}"
                party_shares[key] = shares
                constituencies.append(key)
            
            results = self.predict(constituencies, party_shares)
            
            options = sorted(set(self.endorsements.values()))
            records = []
            
            for const_key, projection in results.items():
                const_name = const_key.replace(f'_{election_date}', '')
                record = {'Constituency': const_name, 'Date': election_date}
                record.update(projection)
                records.append(record)
            
            df = pd.DataFrame(records)
            for opt in options:
                if opt in df.columns:
                    df[f'{opt}_pct'] = df[opt] * 100
            
            return df.sort_values('Constituency')
            
        except Exception as e:
            logging.error(f"Error in predict_from_workbook: {e}")
            import traceback
            traceback.print_exc()
            return {}
    
    def get_model_info(self) -> Dict[str, Any]:
        """Return model configuration."""
        return {
            "model_type": "SimpleEndorsementModel",
            "framework": "endorsement_probability",
            "endorsements": len(self.endorsements),
            "fitted": self.is_fitted,
            "model_type": self.model_type
        }
    
    def predict_proba_rows(self, rows: List[Dict[str, Any]], **kwargs) -> List[Dict[str, float]]:
        """
        Web app interface: predict probabilities for multiple rows.
        
        Args:
            rows: List of constituency data rows
            Each row should contain party vote share information
            
        Returns:
            List of probability dictionaries for each row
            [{option: probability, ...}, ...]
        """
        # Model is pre-fitted in __init__ (simple model, no training needed)
        # Use property check for safety with fallback
        if not self.is_fitted:
            # Log warning but continue (simple model is always ready after init)
            logging.warning("Model accessed before explicit fit() - but continuing (pre-fitted model)")
            self._is_fitted = True  # Ensure it's set
        
        # Continue with prediction
        
        results = []
        
        for row in rows:
            # Extract constituency name and party shares from row
            constituency = row.get('constituency', 'Unknown')
            party_shares = {}
            
            # Build party_shares dict from row data
            # Assuming row contains party columns with vote shares
            for party in self.endorsements.keys():
                if party in row and row[party] > 0:
                    party_shares[party] = float(row[party])
            
            # Make prediction for this constituency
            const_key = constituency
            pred_result = self.predict(
                constituencies=[const_key],
                party_shares={const_key: party_shares}
            )
            
            # Format result as probability dict
            if const_key in pred_result:
                projection = pred_result[const_key]
                # Convert to probabilities (ensure they sum to 1.0)
                total = sum(projection.values()) or 1.0
                probabilities = {opt: score/total for opt, score in projection.items()}
                results.append(probabilities)
            else:
                # No prediction, return empty or uniform distribution
                results.append({})
        
        return results
    
    def predict_proba(self, constituency: str, party_shares: Dict[str, float]) -> Dict[str, float]:
        """
        Predict probabilities for a single constituency.
        
        Args:
            constituency: Constituency name
            party_shares: {party: vote_share}
            
        Returns:
            {option: probability}
        """
        result = self.predict(
            constituencies=[constituency],
            party_shares={constituency: party_shares}
        )
        
        if constituency in result:
            projection = result[constituency]
            total = sum(projection.values()) or 1.0
            return {opt: score/total for opt, score in projection.items()}
        
        return {}


# Export the class
__all__ = ['_NNReferendumWrapper']