"""
FAST FEATURE ENGINEERING with AGGRESSIVE CACHING
Zero compromise on feature quality or accuracy
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Optional, Any, Set
from datetime import datetime
import logging
import hashlib
import pickle
import os

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')


class FastReferendumFeatureEngineer:
    """
    Fast feature engineer with aggressive caching.
    Maintains identical feature quality - only avoids recomputation.
    """
    
    def __init__(self):
        self.census_data = None
        self.endorsement_history = None
        self.enrolled_constituencies = set()
        
        # AGGRESSIVE CACHING - multiple cache levels
        self._feature_cache = {}  # Key: (constituency, feature_date, max_date)
        self._endorsements_cache = {}  # Key: (referendum_type, xl_path)
        self._constituency_cache = {}  # Key: (target_date, result_type)
        self._historical_cache = {}  # Key: (max_date)
        self._aggregated_cache = {}  # Key: (tuple(constituencies), date)
        self._date_party_stats = {} # Key: date -> {party -> votes} (Global pre-computed stats)
        
    def _get_feature_cache_key(self, constituency: str, feature_date: str, 
                              max_historical_date: str, option_keys: tuple, endorsements: Dict = None) -> str:
        """Create deterministic cache key for features."""
        # Hash endorsements to ensure cache invalidation if they change
        endo_str = ""
        if endorsements:
            # Create a stable string representation of critical endorsement info
            # Sort keys to ensure determinism
            items = sorted([(k, str(v.get('position',''))) for k,v in endorsements.items() if v])
            endo_str = str(items)
            
        key_string = f"{constituency}:{feature_date}:{max_historical_date}:{sorted(option_keys)}:{endo_str}"
        return hashlib.sha256(key_string.encode()).hexdigest()
    
    def _get_constituency_cache_key(self, target_date: str, result_type: str, 
                                   election_results_hash: str) -> str:
        """Cache key for constituency lookups."""
        key_string = f"{target_date}:{result_type}:{election_results_hash}"
        return hashlib.sha256(key_string.encode()).hexdigest()
    
    def load_census_data(self, census_path: str = 'Census2001.xlsx') -> pd.DataFrame:
        """Load census data with in-memory caching."""
        cache_key = f"census:{census_path}"
        
        if cache_key in self._historical_cache:
            logging.debug(f"Using cached census data: {census_path}")
            return self._historical_cache[cache_key]
        
        logging.info(f"Loading Census data from {census_path}...")
        census_xl = pd.ExcelFile(census_path)
        sheet_names = census_xl.sheet_names
        logging.info(f"Available sheets: {sheet_names}")
        
        dfs = []
        for sheet in sheet_names:
            if 'normalised' in sheet.lower():
                df = census_xl.parse(sheet)
                dfs.append(df)
        
        if not dfs:
            logging.warning("No 'Normalised' sheets found in Census data")
            result = pd.DataFrame()
        else:
            full_df = pd.concat(dfs, ignore_index=True)
            
            full_df['Table'] = full_df['Table'].astype(str).str.strip()
            full_df['ColumnLabel'] = full_df['ColumnLabel'].astype(str).str.strip()
            
            census_features = self._extract_census_features(full_df)
            result = census_features
        
        # Cache result
        self._historical_cache[cache_key] = result
        return result
    
    def _extract_census_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Extract normalized census features pivoted by constituency."""
        logging.info(f"Extracting census features from {len(df):,} rows...")
        
        # Filter valid rows
        df = df.dropna(subset=['RowLabel1', 'Table', 'ColumnLabel', 'Value']).copy()
        
        # Create feature names
        df['FeatureName'] = df['Table'].astype(str) + " | " + df['ColumnLabel'].astype(str)
        
        # Clean constituency names for matching
        df['Constituency_clean'] = df['RowLabel1'].apply(self.clean_constituency_name)
        
        # Pivot: Index=Constituency, Columns=Features, Values=Value
        # Use 'first' as aggregation since (Constituency, Feature) should be unique
        pivot = df.pivot_table(index='Constituency_clean', columns='FeatureName', values='Value', aggfunc='first')
        
        # Fill NaNs
        pivot = pivot.fillna(0)
        
        logging.info(f"✓ Extracted {len(pivot.columns)} census feature columns for {len(pivot)} constituencies")
        
        return pivot

    def get_constituencies_for_date(self, election_results: pd.DataFrame, target_date: str, 
                                   result_type: str = 'Candidate') -> List[str]:
        """Get constituencies with aggressive caching."""
        # Create hash of election_results for cache invalidation
        data_hash = str(hash(pd.util.hash_pandas_object(election_results).sum()))
        cache_key = self._get_constituency_cache_key(target_date, result_type, data_hash)
        
        if cache_key in self._constituency_cache:
            logging.debug(f"Using cached constituencies for {target_date}")
            return self._constituency_cache[cache_key]
        
        # Compute fresh
        logging.debug(f"Finding constituencies for {target_date}, result_type={result_type}")
        
        all_dates = election_results[
            (election_results['DateStr'] <= target_date) & 
            (election_results['ResultType'] == 'Candidate')
        ]['DateStr'].unique()
        
        if len(all_dates) == 0:
            logging.warning(f"No elections found on or before {target_date}")
            result = []
        else:
            most_recent_date = sorted(all_dates)[-1]
            logging.info(f"Using election date: {most_recent_date} (most recent <= {target_date})")
            
            query = (election_results['DateStr'] == most_recent_date)
            if result_type:
                query = query & (election_results['ResultType'] == result_type)
            
            result = election_results[query]['Constituency'].unique().tolist()
            logging.info(f"Found {len(result)} constituencies")
        
        # Cache result
        self._constituency_cache[cache_key] = result
        return result

    def build_features_for_constituency(self, constituency: str, election_results: pd.DataFrame,
                                       endorsements: Dict[str, Dict[str, str]], feature_date: str,
                                       census_features: Optional[pd.DataFrame] = None,
                                       option_1_keys: Optional[Set[str]] = None,
                                       option_2_keys: Optional[Set[str]] = None,
                                       max_historical_date: Optional[str] = None) -> pd.Series:
        """Build features with aggressive caching."""
        # ... (Keep existing cache check logic) ...
        
        # Create cache key
        cache_key = self._get_feature_cache_key(
            constituency, feature_date, max_historical_date or feature_date,
            option_1_keys or set(), endorsements
        )
        
        if cache_key in self._feature_cache:
            logging.debug(f"Using cached features for {constituency}")
            return self._feature_cache[cache_key]
        
        # Build features fresh
        const_data = election_results[
            (election_results['Constituency'] == constituency) &
            (election_results['DateStr'] == feature_date) &
            (election_results['ResultType'] == 'Candidate')
        ]
        
        if const_data.empty:
            return pd.Series(dtype=float)
        
        features = {}
        
        # ... (Keep party aggregation logic) ...
        agg_cache_key = f"agg:{feature_date}:{max_historical_date}"
        if agg_cache_key not in self._aggregated_cache:
            self._aggregated_cache[agg_cache_key] = self._pre_aggregate_parties(
                election_results, feature_date, max_historical_date
            )
        
        party_aggregates = self._aggregated_cache[agg_cache_key]
        
        # Extract features for major parties (Keep existing logic)
        major_parties = [
            'Sinn Féin', 'SDLP', ' Alliance Party', 'UUP', 'DUP',
            'Traditional Unionist Voice', 'Green Party', 'People Before Profit',
            'Progressive Unionist Party', 'UKIP', 'Independent'
        ]
        
        for party in major_parties:
            party_key = party.lower().replace(' ', '_').replace("'", '')
            share = 0.0
            first_prefs = 0.0
            designation = 2
            
            if party in party_aggregates:
                share = party_aggregates[party]['share']
                first_prefs = party_aggregates[party].get('first_prefs', 0.0)
                designation = party_aggregates[party]['designation']
            
            features[f"{party_key}_share"] = share
            features[f"{party_key}_first_prefs"] = first_prefs
            features[f"{party_key}_designation"] = designation
            
            endorsement_val = 0.0
            if endorsements:
                party_endo = endorsements.get(party)
                if not party_endo:
                    for p_name, p_data in endorsements.items():
                        if p_name.lower().strip() == party.lower().strip():
                            party_endo = p_data
                            break
                if party_endo:
                    position = str(party_endo.get('position', '')).lower()
                    opt1_norm = {k.lower() for k in (option_1_keys or set())}
                    opt2_norm = {k.lower() for k in (option_2_keys or set())}
                    if any(k in position for k in opt1_norm): endorsement_val = 1.0
                    elif any(k in position for k in opt2_norm): endorsement_val = -1.0
                    elif "did not vote" in position or "boycott" in position: endorsement_val = 2.0
            
            features[f"{party_key}_endorsement"] = endorsement_val

        # ... (Keep Totals & Advanced Metrics logic) ...
        total_share_opt1 = 0.0
        total_share_opt2 = 0.0
        total_share_dnv = 0.0
        
        share_opt1_uni = 0.0
        share_opt1_nat = 0.0
        share_opt2_uni = 0.0
        share_opt2_nat = 0.0
        
        total_share_abstentionist = 0.0
        total_share_pro_attendance = 0.0
        abstentionist_active_share = 0.0
        
        ABSTENTIONIST_PARTIES = {
            'sinn féin', 'sinn fein', 'republican sinn féin', 'republican sinn fein',
            'aontú', 'aontu', 'anti h-block', 'anti h-block/armagh'
        }
        
        opt1_norm = {k.lower() for k in (option_1_keys or set())}
        opt2_norm = {k.lower() for k in (option_2_keys or set())}
        
        const_total_votes = const_data['Votes1'].sum()
        
        for _, row in const_data.iterrows():
            party_name = str(row['Party Name']).strip()
            votes = row['Votes1']
            share = votes / const_total_votes if const_total_votes > 0 else 0
            designation = self._get_party_designation(party_name)
            
            is_abstentionist = party_name.lower() in ABSTENTIONIST_PARTIES
            if is_abstentionist:
                total_share_abstentionist += share
            else:
                total_share_pro_attendance += share
            
            if endorsements:
                party_endo = endorsements.get(party_name)
                if not party_endo:
                    for p_name, p_data in endorsements.items():
                        if p_name.lower().strip() == party_name.lower():
                            party_endo = p_data
                            break
                
                if party_endo:
                    pos = str(party_endo.get('position', '')).lower()
                    is_opt1 = any(k in pos for k in opt1_norm)
                    is_opt2 = any(k in pos for k in opt2_norm)
                    
                    if is_opt1:
                        total_share_opt1 += share
                        if designation == 0: share_opt1_uni += share
                        if designation == 1: share_opt1_nat += share
                        if is_abstentionist: abstentionist_active_share += share
                    elif is_opt2:
                        total_share_opt2 += share
                        if designation == 0: share_opt2_uni += share
                        if designation == 1: share_opt2_nat += share
                        if is_abstentionist: abstentionist_active_share += share
                    elif "did not vote" in pos or "boycott" in pos:
                        total_share_dnv += share

        features['total_share_endorsing_opt1'] = total_share_opt1
        features['total_share_endorsing_opt2'] = total_share_opt2
        features['total_share_endorsing_dnv'] = total_share_dnv
        features['share_abstentionist'] = total_share_abstentionist
        features['share_pro_attendance'] = total_share_pro_attendance
        features['abstentionist_active_share'] = abstentionist_active_share
        
        features['endorsement_max_consensus'] = max(total_share_opt1, total_share_opt2)
        features['endorsement_total_participation'] = total_share_opt1 + total_share_opt2
        
        if total_share_opt1 >= total_share_opt2:
            features['endorsement_agreement_score'] = min(share_opt1_uni, share_opt1_nat)
        else:
            features['endorsement_agreement_score'] = min(share_opt2_uni, share_opt2_nat)
        
        # Add census features (FIXED)
        if census_features is not None and not census_features.empty:
            # Lookup constituency in census pivot
            # Normalize the input constituency name first
            const_clean = self.clean_constituency_name(constituency)
            
            if const_clean in census_features.index:
                census_row = census_features.loc[const_clean]
                for col, val in census_row.items():
                    features[col] = float(val)
            else:
                # Fallback if constituency not found in census (e.g. spelling mismatch)
                # Could try fuzzy match or just log warning
                # For now, fill with 0 to avoid model crashing on missing columns
                # Assuming census_features columns are available
                for col in census_features.columns:
                    features[col] = 0.0
        
        # ... (Keep Historical Stats logic) ...
        hist_const_data = election_results[
            (election_results['Constituency'] == constituency) &
            (election_results['DateStr'] <= feature_date) &
            (election_results['DateStr'] >= '1980-01-01')
        ]
        
        hist_turnout = 60.0
        if not hist_const_data.empty:
            date_groups = hist_const_data.groupby('DateStr')
            turnouts = []
            spoiled_rates = []
            for d, group in date_groups:
                total = group['Votes1'].sum()
                elec = group['Electorate'].max() if 'Electorate' in group.columns else 0
                t_pct = 0
                for col in ['Turnout', '% Turnout', 'Percentage Turnout']:
                    if col in group.columns:
                        t_val = group[col].max()
                        if t_val > 0: 
                            t_pct = t_val if t_val > 1.0 else t_val * 100
                            break
                if t_pct == 0 and elec > 0: t_pct = (total / elec) * 100
                if t_pct > 0: turnouts.append(t_pct)
                
                if elec > 0 and t_pct > 0:
                    total_b = elec * (t_pct/100)
                    sp = total_b - total
                    if sp > 0: spoiled_rates.append((sp/total_b)*100)
            
            if turnouts: hist_turnout = np.mean(turnouts)
            features['historical_turnout_mean'] = hist_turnout
            features['historical_spoiled_mean'] = np.mean(spoiled_rates) if spoiled_rates else 1.0
            
            features['swing_nationalist'] = 0.0 
            features['swing_unionist'] = 0.0
            features['swing_turnout'] = 0.0
        else:
            features['historical_turnout_mean'] = 60.0
            features['historical_spoiled_mean'] = 1.0
            features['swing_nationalist'] = 0.0
            features['swing_unionist'] = 0.0
            features['swing_turnout'] = 0.0
            
        features['turnout_headroom'] = 100.0 - hist_turnout

        # Clean columns
        cleaned_features = {}
        for key, value in features.items():
            if isinstance(key, str):
                new_key = key.lower().replace(' ', '_').replace('-', '_')
                new_key = ''.join(c for c in new_key if ord(c) < 128)
                while '__' in new_key: new_key = new_key.replace('__', '_')
                cleaned_features[new_key] = value
            else:
                cleaned_features[str(key)] = value
        
        result_series = pd.Series(cleaned_features)
        self._feature_cache[cache_key] = result_series
        return result_series
    
    def _pre_aggregate_parties(self, election_results: pd.DataFrame, feature_date: str,
                              max_historical_date: str) -> Dict[str, Dict[str, Any]]:
        """Pre-compute party aggregates for a date (Optimized with Global Cache)."""
        
        # 1. Build Global Cache if empty
        if not self._date_party_stats:
            # Compute stats for ALL dates at once (vectorized)
            cand_mask = election_results['ResultType'] == 'Candidate'
            # Group by Date -> Party -> Sum(Votes)
            all_stats = election_results[cand_mask].groupby(['DateStr', 'Party Name'])['Votes1'].sum()
            
            for (d, p), v in all_stats.items():
                if d not in self._date_party_stats:
                    self._date_party_stats[d] = {}
                self._date_party_stats[d][str(p)] = float(v)
        
        # 2. Fast Lookup & Aggregation
        if not max_historical_date:
            max_historical_date = feature_date
            
        valid_dates = sorted([d for d in self._date_party_stats.keys() if d <= max_historical_date])
        recent_dates = valid_dates[-12:] # Last 12 elections
        
        if not recent_dates:
            return {}
            
        agg_votes = {}
        for d in recent_dates:
            date_stats = self._date_party_stats[d]
            for party, votes in date_stats.items():
                agg_votes[party] = agg_votes.get(party, 0.0) + votes
                
        total_votes = sum(agg_votes.values())
        if total_votes == 0: total_votes = 1.0
        
        # 3. Build Result
        aggregates = {}
        for party, votes in agg_votes.items():
            if party and party != 'nan':
                aggregates[party] = {
                    'share': votes / total_votes,
                    'first_prefs': votes,
                    'designation': self._get_party_designation(party)
                }
                
        return aggregates

    def _get_party_designation(self, party: str) -> int:
        """Get party designation code."""
        # Unionist = 0, Nationalist = 1, Other = 2
        party = str(party).strip().lower()
        
        unionist_keywords = ['unionist', 'ulster', 'loyalist', 'uvp', 'pup']
        nationalist_keywords = ['nationalist', 'sinn', 'sdlp', 'republican']
        
        if any(k in party for k in unionist_keywords):
            return 0
        elif any(k in party for k in nationalist_keywords):
            return 1
        else:
            return 2
    
    def _normalise_position(self, value: str) -> str:
        """Normalize position strings."""
        s = str(value or "").strip().lower()
        if s in {"yes", "y", "remain", "united kingdom"}:
            return "Yes"
        if s in {"no", "n", "leave", "united ireland"}:
            return "No"
        if "remain" in s or "stay" in s:
            return "Remain"
        if "leave" in s:
            return "Leave"
        if "united kingdom" in s:
            return "United Kingdom"
        if "united ireland" in s:
            return "United Ireland"
        if "did not vote" in s or "boycott" in s:
            return "Did not vote"
        return str(value).strip()
    
    def clear_cache(self):
        """Clear all caches (call between completely different runs)."""
        self._feature_cache.clear()
        self._aggregated_cache.clear()
        logging.debug("Cleared feature engineering caches")

    def clean_constituency_name(self, name: str) -> str:
        """Standardize constituency names for matching."""
        s = str(name).lower().strip()
        s = s.replace('&', 'and').replace('  ', ' ').replace(',', '')
        s = s.replace(' ', '_').replace('-', '_')
        return s

    def _get_comprehensive_party_map(self) -> Dict[str, Dict[str, str]]:
        """Return robust mapping of Party -> {Designation, Position}. From working original."""
        def entry(des, pos): 
            return {'designation': des, 'position': pos}
        
        mapping = {
            # UNIONIST
            'DUP': entry('Unionist', '?'), 'Democratic Unionist Party': entry('Unionist', '?'),
            'Protestant Unionist Party': entry('Unionist', '?'), 
            'Independent Unionist': entry('Unionist', '?'),
            'UUP': entry('Unionist', '?'), 'Ulster Unionist Party': entry('Unionist', '?'),
            'TUV': entry('Unionist', '?'), 'Traditional Unionist Voice': entry('Unionist', '?'),
            'PUP': entry('Unionist', '?'), 'Progressive Unionist Party': entry('Unionist', '?'),
            'UKIP': entry('Unionist', '?'), 'Conservative': entry('Unionist', '?'),
            'NI Conservatives': entry('Unionist', '?'), 'Heritage Party': entry('Unionist', '?'),
            'NI Labour': entry('Unionist', '?')
        }
        
        # Add nationalist parties
        nationalist_parties = {
            'Sinn F\\xc3\\xa9in': 'Nationalist', 'Sinn F\\xc3\\xa9in': 'Nationalist',
            'Sinn Féin': 'Nationalist',
            'SDLP': 'Nationalist', 'Social Democratic and Labour Party': 'Nationalist',
            'Aont\\xc3\\xba': 'Nationalist', 'Aont\'\\xc3\\xb7': 'Nationalist',
            'Aont\'\\xc3\\xa6': 'Nationalist',
            'People Before Profit': 'Nationalist', 'PBP': 'Nationalist',
            'Workers Party': 'Nationalist', 'IRSP': 'Nationalist',
            'Republican Sinn F\\xc3\\xa9in': 'Nationalist', 'Republican Sinn Féin': 'Nationalist',
            '32 County Sovereignty Movement': 'Nationalist',
            'Independent Nationalist': 'Nationalist',
            'National Democratic Party': 'Nationalist',
            'Nationalist Party': 'Nationalist',
            'Republican Labour Party': 'Nationalist'
        }
        
        for party, designation in nationalist_parties.items():
            if party:  # Skip empty
                mapping[party] = entry(designation, '?')
        
        # Add other/cross-community parties
        other_parties = {
            'Alliance': 'Other', 'Alliance Party': 'Other',
            'Green Party': 'Other', 'Independent': 'Other',
            'Independent Other': 'Other', 'Ulster Liberal Party': 'Other',
            'Unity': 'Other', 'Cross-Community Labour Alternative': 'Other',
            'Labour Alternative': 'Other', 'Socialist Party': 'Other', 'CISTA': 'Other'
        }
        
        for party, designation in other_parties.items():
            mapping[party] = entry(designation, '?')
        
        return mapping
    
    def load_endorsements(self, xl: pd.ExcelFile, referendum_type: str = None) -> Tuple[Dict[str, Dict[str, str]], Dict[float, Dict[str, str]]]:
        """Load endorsements with aggressive caching."""
        # Create cache key from file path and referendum type
        try:
            xl_path = xl.io if hasattr(xl, 'io') else str(xl)
            cache_key = f"endorsements:{xl_path}:{referendum_type}"
        except:
            cache_key = f"endorsements:{referendum_type}"
        
        if cache_key in self._endorsements_cache:
            logging.debug(f"Using cached endorsements for {referendum_type}")
            return self._endorsements_cache[cache_key]
        
        # Load fresh (existing logic preserved for quality)
        logging.info(f"Loading party endorsements and designations...")
        
        party_data = self._get_comprehensive_party_map()
        candidate_data = {}
        
        # Map to event strings
        # Use lists of keywords to match against the 'Event' column in Excel
        event_map = {
            'border': ['border', '1973'],
            'eu': ['europe', 'eu ref', 'brexit'], # Match 'EuropeReferendum' or 'EU Referendum'
            'gfa': ['good friday', 'gfa', 'agreement', '1998'],
            'av': ['alternative vote', 'av ref', '2011']
        }
        
        # Define canonical target_event for hardcoded overrides
        canonical_event_map = {
            'border': 'BorderReferendum',
            'eu': 'EuropeReferendum',
            'gfa': 'GFAReferendum',
            'av': 'AVReferendum'
        }
        target_event = canonical_event_map.get(referendum_type, referendum_type) # Define it here

        target_keywords = event_map.get(referendum_type, [referendum_type])
        if isinstance(target_keywords, str):
            target_keywords = [target_keywords]
        
        try:
            sheet_names = xl.sheet_names
            endorsement_sheet = next((s for s in sheet_names if 'endorse' in s.lower()), None)
            
            if endorsement_sheet:
                df = xl.parse(endorsement_sheet)
                df.columns = [str(c).strip() for c in df.columns]
                
                if target_keywords and 'Event' in df.columns:
                    # Special handling for EU Referendum 2016: aggressively match by year
                    if referendum_type == 'eu':
                        mask = df['Event'].astype(str).apply(lambda x: '2016' in x)
                        if 'Date' in df.columns:
                            mask = mask | (df['Date'].astype(str).str.contains('2016'))
                    else:
                        mask = df['Event'].astype(str).apply(lambda x: any(k.lower() in x.lower() for k in target_keywords))
                        
                    df = df[mask]
                
                # Process rows (same logic, preserved for quality)
                for _, row in df.iterrows():
                    person_id = row.get('PersonID')
                    if pd.notna(person_id) and str(person_id).strip():
                        try:
                            pid = float(person_id)
                            position = self._normalise_position(row.get('Endorsed', row.get('PartyEndorsed', '')))
                            
                            party_name = str(row.get('Party', '')).strip()
                            if not party_name:
                                continue
                            
                            designation = 'Other'
                            if party_name in party_data:
                                designation = party_data[party_name]['designation']
                            
                            candidate_data[pid] = {
                                'designation': designation,
                                'position': position,
                                'name': row.get('Name usually known by', '')
                            }
                        except ValueError:
                            continue
                    else:
                        # Party endorsement
                        party = str(row.get('Party', '')).strip()
                        if not party:
                            continue
                        
                        result_type = str(row.get('ResultType', '')).strip()
                        raw_pos = ''
                        
                        if 'Did not vote' in result_type:
                            raw_pos = 'Did not vote'
                        elif 'Answer' in result_type:
                            raw_pos = row.get('Name usually known by', '')
                            if pd.isna(raw_pos) or not str(raw_pos).strip():
                                raw_pos = row.get('Endorsed', row.get('PartyEndorsed', ''))
                        else:
                            raw_pos = row.get('Endorsed', row.get('PartyEndorsed', ''))
                        
                        position = self._normalise_position(raw_pos)
                        
                        if party not in party_data:
                            party_data[party] = {'designation': 'Other', 'position': position}
                        else:
                            party_data[party]['position'] = position
            
            # Hardcoded overrides (preserving original logic for accuracy)
            if target_event == 'BorderReferendum':
                for p in ['UUP', 'Ulster Unionist Party', 'DUP', 'Democratic Unionist Party']:
                    party_data[p] = {'designation': 'Unionist', 'position': 'United Kingdom'}
                for p in ['SDLP', 'Sinn Féin']:
                    party_data[p] = {'designation': 'Nationalist', 'position': 'Did not vote'}
        
        except Exception as e:
            logging.warning(f"Could not load endorsements sheet: {e}")
        
        # Cache and return
        result = (party_data, candidate_data)
        self._endorsements_cache[cache_key] = result
        return result
    
    def _get_party_designation(self, party: str) -> int:
        """Get party designation code."""
        # Unionist = 0, Nationalist = 1, Other = 2
        party = str(party).strip().lower()
        
        unionist_keywords = ['unionist', 'ulster', 'loyalist', 'uvp', 'pup']
        nationalist_keywords = ['nationalist', 'sinn', 'sdlp', 'republican']
        
        if any(k in party for k in unionist_keywords):
            return 0
        elif any(k in party for k in nationalist_keywords):
            return 1
        else:
            return 2
    
    def _normalise_position(self, value: str) -> str:
        """Normalize position strings."""
        s = str(value or "").strip().lower()
        if s in {"yes", "y", "remain", "united kingdom"}:
            return "Yes"
        if s in {"no", "n", "leave", "united ireland"}:
            return "No"
        if "remain" in s or "stay" in s:
            return "Remain"
        if "leave" in s:
            return "Leave"
        if "united kingdom" in s:
            return "United Kingdom"
        if "united ireland" in s:
            return "United Ireland"
        if "did not vote" in s or "boycott" in s:
            return "Did not vote"
        return str(value).strip()
    
    def clear_cache(self):
        """Clear all caches (call between completely different runs)."""
        self._feature_cache.clear()
        self._aggregated_cache.clear()
        logging.debug("Cleared feature engineering caches")

    def clean_constituency_name(self, name: str) -> str:
        """Standardize constituency names for matching."""
        s = str(name).lower().strip()
        s = s.replace('&', 'and').replace('  ', ' ').replace(',', '')
        s = s.replace(' ', '_').replace('-', '_')
        return s