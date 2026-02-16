"""
IMPROVED TRANSFER MODEL INTEGRATION
Wraps the enhanced robust model to work seamlessly with base validator
This minimizes changes to proven seat prediction logic while upgrading transfers
"""

import sys
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

# Override the original get_transfer_model to use enhanced version
def get_enhanced_transfer_model_base():
    """Factory for robust model that works with base validator."""
    from ni_votes.features.transfers_enhanced_robust import get_robust_transfer_model
    return get_robust_transfer_model()


def override_transfer_model():
    """Replace the global get_transfer_model with enhanced version."""
    
    try:
        # Import the robust model
        from ni_votes.features.transfers_enhanced_robust import get_robust_transfer_model, RobustTransferModel
        from ni_votes.validation.cross_validator import CrossValidator
        
        # Store original method
        original_validate_fold = CrossValidator.validate_fold
        
        # Create replacement method that uses enhanced model
        def validate_fold_with_enhanced_model(self, fold_idx, train_elections, test_elections, 
                                             progress_callback=None, er_df=None, tr_df=None):
            """Enhanced validate_fold using robust transfer model."""
            
            from typing import Dict, List, Any
            import pandas as pd
            
            results = {
                "fold_idx": fold_idx,
                "train_count": len(train_elections),
                "test_count": len(test_elections),
                "seat_predictions": {},
                "seat_actuals": {},
                "transfer_predictions": {},
                "transfer_actuals": {},
                "errors": [],
                "warnings": [],
                "elections_processed": 0,
                "elections_skipped": 0
            }
            
            # Build training data for enhanced model
            if train_elections:
                training_data = self._build_enhanced_training_data(train_elections)
                if training_data:
                    enhanced_model = get_robust_transfer_model()
                    enhanced_model.fit(training_data)
                    logging.info(f"Enhanced model trained on {len(training_data)} elections")
                else:
                    enhanced_model = None
            else:
                enhanced_model = None
            
            # Test each election
            for idx, election in enumerate(test_elections):
                try:
                    # Use enhanced model if available
                    if enhanced_model is not None:
                        from ni_votes.simulate.engine import run_scenario
                        
                        names, parties, person_ids, first_prefs = election.get_first_prefs()
                        
                        scenario_dict = {
                            "constituency": election.constituency,
                            "seats": election.seats,
                            "date": election.date,
                            "names": names,
                            "parties": parties,
                            "person_ids": person_ids,
                            "first_prefs": first_prefs,
                            "merge_by_party": False,
                            "ignore_priors": True,
                            "debug_mode": False,
                            "_prebuilt_model": enhanced_model
                        }
                        
                        result = run_scenario(er_df, tr_df, scenario_dict)
                    else:
                        # Fallback to original approach
                        result = self._simulate_election(election, er_df, tr_df)
                    
                    if not result:
                        logging.error(f"No result for {election.election_id}")
                        continue
                    
                    # Extract predictions (use base class methods which work)
                    predicted_elected = self._extract_predicted_elected(result, election)
                    actual_elected = election.get_actual_elected()
                    
                    pred_transfers = self._extract_transfer_predictions(result, election)
                    actual_transfers = election.get_transfer_events()
                    
                    results["seat_predictions"][election.election_id] = predicted_elected
                    results["seat_actuals"][election.election_id] = actual_elected
                    results["transfer_predictions"][election.election_id] = pred_transfers
                    results["transfer_actuals"][election.election_id] = actual_transfers
                    
                    results["elections_processed"] += 1
                    
                except Exception as e:
                    logging.error(f"Error in {election.election_id}: {e}")
                    results["errors"].append({
                        "election": election.election_id,
                        "error": str(e)
                    })
                    results["elections_skipped"] += 1
                    continue
            
            return results
        
        # Add the helper method to build enhanced training data
        def _build_enhanced_training_data(self, elections):
            """Build training data for robust model."""
            training_data = []
            
            for election in elections:
                names, parties, person_ids, first_prefs = election.get_first_prefs()
                
                if len(names) < 2:
                    continue
                
                # Build election data
                election_data = {
                    "constituency": election.constituency,
                    "date": election.date,
                    "seats": election.seats,
                    "names": names,
                    "parties": parties,
                    "person_ids": person_ids,
                    "first_prefs": first_prefs,
                    "transfer_events": election.get_transfer_events()
                }
                
                training_data.append(election_data)
            
            return training_data
        
        # Add methods to CrossValidator
        CrossValidator.validate_fold = validate_fold_with_enhanced_model
        CrossValidator._build_enhanced_training_data = _build_enhanced_training_data
        
        logging.info("Successfully overridden CrossValidator.validate_fold to use enhanced model")
        return True
        
    except Exception as e:
        logging.error(f"Failed to override: {e}")
        import traceback
        traceback.print_exc()
        return False


# Apply the override when this module is imported
if __name__ != "__main__":
    success = override_transfer_model()
    if not success:
        logging.warning("Enhanced model override failed, falling back to base validator")