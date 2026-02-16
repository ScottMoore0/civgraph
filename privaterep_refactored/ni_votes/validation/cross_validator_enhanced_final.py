"""
ENHANCED CROSS-VALIDATOR - FINAL WORKING VERSION
Uses working base validator + fixes transfer extraction
"""

from typing import Dict, List, Any, Tuple, Optional, Set
import pandas as pd
import numpy as np
from collections import defaultdict
import time
import logging

# Import working base validator
from ni_votes.validation.cross_validator import CrossValidator, Election as BaseElection

# Import robust transfer model
from ni_votes.features.transfers_enhanced_robust import get_robust_transfer_model


class ElectionEnhanced(BaseElection):
    """
    Enhanced Election class that fixes the transfer extraction bug.
    The base class uses "RecipientPersonId" which doesn't exist in the data.
    """
    
    def get_transfer_events(self) -> List[Dict[str, Any]]:
        """Extract transfer events - each row represents a transfer FROM Name TO TransferName."""
        if self.transfer_data.empty:
            return []
        
        events_by_donor = {}
        
        for count_num in sorted(self.transfer_data["Count"].unique()):
            count_data = self.transfer_data[self.transfer_data["Count"] == count_num]
            
            # Group by donor (the person whose votes are being transferred)
            for donor_id in count_data["PersonID"].unique():
                if pd.isna(donor_id):
                    continue
                    
                donor_rows = count_data[count_data["PersonID"] == donor_id]
                
                if donor_rows.empty:
                    continue
                
                donor_name = donor_rows.iloc[0]["Name"]
                
                # Get candidate names for index lookup
                candidate_names, _, _, _ = self.get_first_prefs()
                
                try:
                    donor_idx = candidate_names.index(donor_name) if donor_name in candidate_names else 0
                except (ValueError, AttributeError):
                    donor_idx = 0
                
                # Get quota (it should be the same for all rows in same count)
                quota = 8000  # Default
                if "Quota" in donor_rows.columns:
                    quota_row = donor_rows[pd.notna(donor_rows["Quota"])]
                    if not quota_row.empty:
                        quota = float(quota_row.iloc[0]["Quota"])
                
                # Build recipient dictionary from ALL rows (each row represents a transfer)
                recipients = {}
                non_transferable = 0.0
                
                for _, row in donor_rows.iterrows():
                    recipient_name = row["TransferName"]
                    transfers = float(row["Transfers"])
                    
                    # Skip self-transfers
                    if recipient_name == donor_name:
                        # This is likely an elimination, count as non-transferable if negative
                        if transfers < 0:
                            non_transferable += abs(transfers)
                        continue
                    
                    if recipient_name and str(recipient_name) != "nan" and transfers > 0:
                        recipients[str(recipient_name)] = transfers
                
                # Calculate total flow
                total_to_recipients = sum(recipients.values())
                
                # Create event if there are any transfers
                if total_to_recipients > 0 or non_transferable > 0:
                    events_by_donor.setdefault(count_num, []).append({
                        "donor_index": donor_idx,
                        "donor_name": donor_name,
                        "count": int(count_num),
                        "recipients": recipients,
                        "non_transferable": max(0, non_transferable),
                        "quota": quota,
                        "total_leaving": total_to_recipients + max(0, non_transferable)
                    })
        
        # Flatten events_by_donor into events list
        events = []
        for count_events in events_by_donor.values():
            events.extend(count_events)
        
        return events


class CrossValidatorEnhanced(CrossValidator):
    """
    Enhanced cross-validator that uses fixed Election class for proper transfer extraction.
    """
    
    def __init__(self, er_df: pd.DataFrame, tr_df: pd.DataFrame, k_folds: int = 5):
        # Note: We don't call super() here because we're overriding election building
        self.er_df = er_df
        self.tr_df = tr_df
        self.k_folds = k_folds
        self.elections = []
    
    def _identify_eligible_elections(self, progress_callback=None) -> List[ElectionEnhanced]:
        """Override to use enhanced Election class."""
        
        logging.info("Scanning for eligible elections...")
        eligible = []
        
        # Use same logic as base but create ElectionEnhanced objects
        try:
            # Group data for efficiency
            er_df_norm = self.er_df.copy()
            tr_df_norm = self.tr_df.copy()
            
            for df in [er_df_norm, tr_df_norm]:
                if "DateStr" not in df.columns and "Date" in df.columns:
                    df["DateStr"] = df["Date"]
            
            er_grouped = er_df_norm.groupby(["DateStr", "Constituency"])
            tr_grouped = tr_df_norm.groupby(["DateStr", "Constituency"])
            
            unique_elections = er_df_norm[["DateStr", "Constituency", "ElectedBody"]].drop_duplicates()
            
            for idx, row in unique_elections.iterrows():
                if progress_callback and idx % 10 == 0 and idx > 0:
                    progress_callback(f"Scanning {idx}/{len(unique_elections)}")
                
                date = row["DateStr"]
                constituency = row["Constituency"]
                body = row["ElectedBody"]
                
                # Check for transfer data
                group_key = (date, constituency)
                if group_key not in tr_grouped.groups:
                    continue
                
                transfer_subset = tr_grouped.get_group(group_key)
                if transfer_subset["Count"].nunique() < 2:
                    continue
                
                # Build candidates
                cand_subset = er_grouped.get_group(group_key)
                candidates = []
                
                for _, cand_row in cand_subset.iterrows():
                    result_type = str(cand_row.get("ResultType", "")).strip()
                    if result_type and result_type != "Candidate":
                        continue
                    
                    name = cand_row.get("Name usually known by", "") or cand_row.get("Source Name", "")
                    if not name or str(name) == "nan" or pd.isna(cand_row.get("Votes1")):
                        continue
                    
                    candidates.append({
                        "name": str(name).strip(),
                        "party": str(cand_row.get("Party Name", "")).strip(),
                        "person_id": str(cand_row.get("PersonID", "")).strip(),
                        "first_pref": float(cand_row.get("Votes1", 0)),
                        "is_elected": str(cand_row.get("Outcome", "")).strip().lower() == "elected"
                    })
                
                if len(candidates) < 2:
                    continue
                
                # Calculate seats
                seats = max(1, sum(1 for c in candidates if c["is_elected"]))
                if seats == 0:
                    seats = int(cand_subset.iloc[0].get("Seats", 1))
                
                # Create ElectionEnhanced instead of base Election
                election = ElectionEnhanced(
                    date=date,
                    constituency=constituency,
                    body=body,
                    seats=seats,
                    candidate_data=candidates,
                    transfer_data=transfer_subset
                )
                
                eligible.append(election)
            
            logging.info(f"Found {len(eligible)} eligible elections")
            return eligible
            
        except Exception as e:
            logging.error(f"Error in _identify_eligible_elections: {e}")
            return []
    
    def _build_enhanced_training_data(self, elections: List[ElectionEnhanced]) -> List[Dict[str, Any]]:
        """Build training data for robust model."""
        training_data = []
        total_events = 0
        
        for election in elections:
            names, parties, person_ids, first_prefs = election.get_first_prefs()
            
            if len(names) < 2:
                continue
            
            # Use the fixed get_transfer_events from ElectionEnhanced
            events = election.get_transfer_events()
            
            election_data = {
                "constituency": election.constituency,
                "date": election.date,
                "seats": election.seats,
                "names": names,
                "parties": parties,
                "person_ids": person_ids,
                "first_prefs": first_prefs,
                "transfer_events": events
            }
            
            training_data.append(election_data)
            total_events += len(events)
        
        logging.info(f"Built training data: {len(training_data)} elections, {total_events} events")
        return training_data
    
    def validate_fold(self, fold_idx: int, train_elections: List[ElectionEnhanced],
                     test_elections: List[ElectionEnhanced], progress_callback=None,
                     er_df=None, tr_df=None) -> Dict[str, Any]:
        """Run fold validation with robust model."""
        
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
        
        # Build and train model
        logging.info(f"Training fold {fold_idx}...")
        training_data = self._build_enhanced_training_data(train_elections)
        
        if not training_data:
            logging.warning("No training data")
            return results
        
        # Train robust model
        enhanced_model = get_robust_transfer_model()
        enhanced_model.fit(training_data)
        logging.info(f"Model trained on {len(training_data)} elections")
        
        # Test elections
        for idx, election in enumerate(test_elections):
            if progress_callback:
                progress_callback({
                    "type": "validation",
                    "progress": (idx + 1) / len(test_elections),
                    "message": f"Testing {election.constituency}"
                })
            
            try:
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
                
                from ni_votes.simulate.engine import run_scenario
                result = run_scenario(er_df, tr_df, scenario_dict)
                
                # Extract predictions
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


def get_enhanced_cross_validator(er_df: pd.DataFrame, tr_df: pd.DataFrame, 
                                k_folds: int = 5) -> CrossValidatorEnhanced:
    """Factory function."""
    return CrossValidatorEnhanced(er_df, tr_df, k_folds)