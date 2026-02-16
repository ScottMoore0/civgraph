"""
ML FEATURE ENGINEERING FOR REFERENDUM PREDICTION

This module creates features from:
1. Census demographics (Census2001.xlsx)
2. Party vote shares (Full election tables.xlsx)
3. Party endorsements (Endorsements sheet)
4. Historical referendum results (if available)
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Optional, Any, Set
from datetime import datetime
import logging
import re

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')


class ReferendumFeatureEngineer:
    """Creates ML-ready features for referendum outcome prediction."""
    
    def __init__(self):
        self.census_data = None
        self.endorsement_history = None
        self.enrolled_constituencies = set()
        self._endorsements_cache = {}  # Cache key -> endorsements dict
        
    def _get_endorsements_cache_key(self, xl, referendum_type):
        """Create cache key based on file path and referendum type."""
        try:
            xl_path = xl.io if hasattr(xl, 'io') else str(xl)
            return f"{xl_path}:{referendum_type}"
        except:
            return str(referendum_type)  # Fallback
            
    def load_endorsements(self, xl: pd.ExcelFile, referendum_type: str = None) -> Tuple[Dict[str, Dict[str, str]], Dict[float, Dict[str, str]]]:
        """Load party/candidate endorsements with caching to avoid repeated file reads."""
        cache_key = self._get_endorsements_cache_key(xl, referendum_type)
        
        if cache_key in self._endorsements_cache:
            logging.debug(f"Using cached endorsements for {referendum_type}")
            return self._endorsements_cache[cache_key]
        
        logging.info(f"Loading party endorsements and designations...")
        party_endorsements = {}
        candidate_endorsements = {}
        
    def load_census_data(self, census_path: str = 'Census2001.xlsx') -> pd.DataFrame:
        """Load and process Census 2001 demographic data from normalized format."""
        logging.info(f"Loading Census data from {census_path}...")
        
        try:
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
                return pd.DataFrame()
                
            full_df = pd.concat(dfs, ignore_index=True)
            
            # Clean columns for matching
            full_df['Table'] = full_df['Table'].astype(str).str.strip()
            full_df['ColumnLabel'] = full_df['ColumnLabel'].astype(str).str.strip()
            
            # Define explicit mapping of (Table, ColumnLabel) -> FeatureName
            # Based on analysis of census_summary.txt
            FEATURE_MAPPING = {
                ('Table KS01: USUALLY RESIDENT POPULATION', 'All persons'): 'Total_pop',
                ('Table KS07b: COMMUNITY BACKGROUND: RELIGION OR RELIGION BROUGHT UP IN', 'Percentage of persons with community background: Catholic(1)'): 'Catholic_%',
                ('Table KS07b: COMMUNITY BACKGROUND: RELIGION OR RELIGION BROUGHT UP IN', 'Percentage of persons with community background: Protestant and Other Christian (including Christian related)'): 'Protestant_%',
                ('Table KS07b: COMMUNITY BACKGROUND: RELIGION OR RELIGION BROUGHT UP IN', 'Percentage of persons with community background: None'): 'No_Religion_%',
                ('Table KS07b: COMMUNITY BACKGROUND: RELIGION OR RELIGION BROUGHT UP IN', 'Percentage of persons with community background: Other religions and philosophies'): 'Other_Religion_%',
                ('Table KS09a: ECONOMIC ACTIVITY - ALL PERSONS', 'Percentage of persons aged 16-74: Economically active, Unemployed'): 'Unemployment_%',
                ('Table KS13: QUALIFICATIONS AND STUDENTS', 'Percentage of persons aged 16-74 with: Highest qualification attained: Level 5(5)'): 'Degree_Level_%',
                ('Table KS02: AGE(1) STRUCTURE', 'Mean age(2) of population in the area'): 'Mean_Age',
                ('Table KS02: AGE(1) STRUCTURE', 'Percent- age of persons aged: 18-19'): 'Age_18_19_%',
                ('Table KS02: AGE(1) STRUCTURE', 'Percent- age of persons aged: 20-24'): 'Age_20_24_%'
            }
            
            extracted_data = []
            
            for (table, col_label), feature_name in FEATURE_MAPPING.items():
                # Find rows matching this feature
                mask = (full_df['Table'] == table) & (full_df['ColumnLabel'] == col_label)
                rows = full_df[mask]
                
                if rows.empty:
                    logging.warning(f"Could not find Census feature: {feature_name} ({table} - {col_label})")
                    continue
                    
                # Keep just Constituency and Value
                subset = rows[['RowLabel1', 'Value']].copy()
                subset.columns = ['Constituency', feature_name]
                
                # Clean constituency name immediately
                subset['Constituency_clean'] = subset['Constituency'].apply(self._clean_constituency_name)
                subset = subset.drop(columns=['Constituency'])
                
                extracted_data.append(subset)
            
            if not extracted_data:
                logging.warning("No features extracted from Census data")
                return pd.DataFrame()
                
            # Merge all features on Constituency_clean
            census_features = extracted_data[0]
            for df in extracted_data[1:]:
                census_features = pd.merge(census_features, df, on='Constituency_clean', how='outer')
            
            # Fill NaNs with 0 (or appropriate defaults)
            census_features = census_features.fillna(0)
            
            logging.info(f"Loaded Census data with features: {list(census_features.columns)}")
            self.census_data = census_features
            return census_features
            
        except Exception as e:
            logging.warning(f"Could not load Census data: {e}")
            import traceback
            logging.warning(traceback.format_exc())
            return pd.DataFrame()
    
    def _clean_constituency_name(self, name: str) -> str:
        """Clean constituency names for matching."""
        if pd.isna(name):
            return ""
        name = str(name).lower().strip()
        name = name.replace('st.', 'st').replace('st ', 'st ')
        name = name.replace(' & ', ' and ')
        name = name.replace('-', ' ').replace('  ', ' ')
        return name.title().strip()
    
    def _map_constituency_to_census(self, name: str) -> str:
        """Map election constituency names to Census 2001 constituency names.
        
        Handles boundary changes between elections and Census 2001.
        Census data is applicable from 1995 onwards.
        """
        name_clean = self._clean_constituency_name(name)
        
        # Constituency boundary mappings
        mappings = {
            'Belfast South And Mid Down': 'Belfast South',
            'Mid Down': 'Belfast South'  # Also map Mid Down alone
        }
        
        return mappings.get(name_clean, name_clean)
    
    def load_endorsements(self, xl: pd.ExcelFile, referendum_type: str = None) -> Tuple[Dict[str, Dict[str, str]], Dict[float, Dict[str, str]]]:
        """
        Load endorsements from Excel.
        Returns:
            party_data: Dict[PartyName, {designation, position}]
            candidate_data: Dict[PersonID, {designation, position}]
        """
        logging.info("Loading party endorsements and designations...")
        
        # 1. Start with robust defaults
        party_data = self._get_comprehensive_party_map()
        candidate_data = {}
        
        # Cache key for this load
        cache_key = self._get_endorsements_cache_key(xl, referendum_type)
        
        # Map referendum_type to Event strings in Excel
        event_map = {
            'border': 'BorderReferendum', # 1973
            'eu': 'EuropeReferendum',     # 1975, 2016
            'gfa': 'GFAReferendum',       # 1998
            'av': 'AVReferendum'          # 2011
        }
        
        target_event = event_map.get(referendum_type, referendum_type)
        
        # 2. Try to load sheet for overrides
        try:
            sheet_names = xl.sheet_names
            endorsement_sheet = None
            for sheet in sheet_names:
                if 'endorse' in sheet.lower():
                    endorsement_sheet = sheet
                    break
            
            if endorsement_sheet:
                df = xl.parse(endorsement_sheet)
                
                # Normalize columns
                df.columns = [str(c).strip() for c in df.columns]
                
                # Filter by event if specified
                if target_event:
                    mask = df['Event'].astype(str).apply(lambda x: target_event.lower() in x.lower())
                    df = df[mask]
                
                # Process rows
                for _, row in df.iterrows():
                    # Check if it's a Candidate endorsement (has PersonID)
                    person_id = row.get('PersonID')
                    if pd.notna(person_id) and str(person_id).strip() != '':
                        try:
                            pid = float(person_id)
                            position = self._normalise_position(row.get('Endorsed', row.get('PartyEndorsed', '')))
                            # Designation defaults to Party's designation if not specified, or 'Other'
                            party_name = str(row.get('Party', '')).strip()
                            if 'UKUP' in party_name or 'UK Unionist' in party_name:
                                print(f"DEBUG LOAD: Found {party_name}. Event={row.get('Event')}. ResultType={row.get('ResultType')}")
                            if not party_name: continue
                            designation = 'Other'
                            if party_name in party_data:
                                designation = party_data[party_name]['designation']
                            
                            candidate_data[pid] = {
                                'designation': designation,
                                'position': position,
                                'name': row.get('Name usually known by', '')
                            }
                        except ValueError:
                            logging.warning(f"Invalid PersonID: {person_id}")
                            continue
                    else:
                        # Party endorsement
                        # Determine position based on ResultType and User Schema
                        result_type = str(row.get('ResultType', '')).strip()
                        
                        party = str(row.get('Party', '')).strip()
                        if 'UKUP' in party or 'UK Unionist' in party:
                            print(f"DEBUG LOAD PARTY: Found {party}. Event={row.get('Event')}. ResultType={result_type}")
                        if not party: continue
                        raw_pos = ''
                        
                        if 'Did not vote' in result_type:
                            raw_pos = 'Did not vote'
                        elif 'Answer' in result_type:
                            # For Referendum Answers, the option label is in 'Name usually known by'
                            raw_pos = row.get('Name usually known by', '')
                            # Fallback to PartyEndorsed if Name is empty (though unlikely for Answer)
                            if pd.isna(raw_pos) or str(raw_pos).strip() == '':
                                raw_pos = row.get('Endorsed', row.get('PartyEndorsed', ''))
                        else:
                            # For Candidates (Party Endorsements), use PartyEndorsed
                            raw_pos = row.get('Endorsed', row.get('PartyEndorsed', ''))
                            # Fallback to Name usually known by if PartyEndorsed is empty (e.g. 1998 GFA edge case)
                            if pd.isna(raw_pos) or str(raw_pos).strip() == '' or str(raw_pos).lower() == 'nan':
                                raw_pos = row.get('Name usually known by', '')

                        position = self._normalise_position(raw_pos)
                        
                        if party not in party_data:
                            party_data[party] = {'designation': 'Other', 'position': position}
                        else:
                            party_data[party]['position'] = position


            
        except Exception as e:
            logging.warning(f"Could not load endorsements sheet: {e}")
            import traceback
            logging.warning(traceback.format_exc())
            
        # Hardcoded overrides (preserve existing logic)
        if target_event == 'BorderReferendum':
            logging.info("Applying hardcoded overrides for 1973 Border Referendum to ensure historical accuracy.")
            # Unionists supported remaining in UK (Option 1)
            for p in ['UUP', 'Ulster Unionist Party', 'Vanguard', 'Vanguard Unionist Progressive Party', 'DUP', 'Democratic Unionist Party', 'NILP', 'Northern Ireland Labour Party', 'Ulster Constitution Party']:
                party_data[p] = {'designation': party_data.get(p, {}).get('designation', 'Unionist'), 'position': 'United Kingdom'}
            
            # Alliance supported UK (Option 1)
            for p in ['Alliance', 'Alliance Party']:
                party_data[p] = {'designation': party_data.get(p, {}).get('designation', 'Other'), 'position': 'United Kingdom'}
                
            # Nationalists Boycotted
            for p in ['SDLP', 'Social Democratic and Labour Party', 'Sinn Féin', 'Republican Clubs', 'Nationalist', 'Nationalist Party', 'Republican Labour Party', 'National Democratic Party']:
                party_data[p] = {'designation': party_data.get(p, {}).get('designation', 'Nationalist'), 'position': 'Did not vote'}
            
        # Cache the results before returning
        if hasattr(self, '_endorsements_cache'):
            self._endorsements_cache[cache_key] = (party_data, candidate_data)
        
        return party_data, candidate_data

    def get_referendum_options(self, er_df: pd.DataFrame, date: str) -> Tuple[str, str]:
        """
        Extract the two referendum option names from actual results data.
        Returns (option1_name, option2_name) or ('', '') if not a referendum.
        """
        # Filter for 'Answer' type in ElectionResults
        # Note: User confirmed column is 'Party Name' in ElectionResults
        answers = er_df[
            (er_df['DateStr'] == date) & 
            (er_df['ResultType'] == 'Answer')
        ]
        
        if answers.empty: # Changed from len(answers) < 2 to answers.empty for clarity and consistency
            # This is an election, not a referendum, or no answers found
            return ("", "")
            
        # The option name is usually in 'Name usually known by'
        # But sometimes it might be in 'Party Name' if 'Name usually known by' is empty
        options = answers['Name usually known by'].dropna().unique()
        
        if len(options) < 2:
             options = answers['Party Name'].dropna().unique() # This line was added/modified
        
        # Filter out special cases (moved this block to after potential Party Name fallback)
        options = [opt for opt in options 
                   if str(opt).lower() not in ['spoiled', 'did not vote', 'nan', '']]
        
        if len(options) < 2:
            logging.warning(f"Expected 2 options for {date}, found {len(options)}: {options}")
            return ('', '')
        
        if len(options) > 2:
            logging.warning(f"Found {len(options)} options for {date}: {options}. Using first 2.")
        
        return (str(options[0]), str(options[1]))
    
    # Mapping from endorsement labels to ballot option names
    REFERENDUM_ENDORSEMENT_MAPPINGS = {
        '1973-03-08': {  # Border Referendum - options are "Yes" and "No"
            'yes': ['united kingdom', 'uk'],  # Yes = United Kingdom (Unionist)
            'no': ['republic of ireland', 'ireland'],  # No = Republic of Ireland (Nationalist)
            # 'boycott' and 'did not vote' handled separately
        },
        '1975-06-05': {  # Europe Referendum (EEC) - options are "Yes" and "No"
            'yes': ['yes', 'remain', 'stay'],
            'no': ['no', 'leave'],
        },
        '1998-05-22': {  # Good Friday Agreement - options are "Yes" and "No"  
            'yes': ['yes', 'agree', 'agreement'],
            'no': ['no', 'against'],
        },
        '2011-05-05': {  # Alternative Vote - options are "Yes" and "No"
            'yes': ['yes'  ],
            'no': ['no'],
        },
        '2016-06-23': {  # EU Referendum
            'leave the european union': ['leave'],
            'remain a member of the european union': ['remain', 'stay'],
        }
    }
    
    def _normalise_position(self, value: str) -> str:
        """
        Try to fold various free-text endorsements into a small, consistent set
        (e.g., 'Yes', 'No', 'Remain', 'Leave', 'Did not vote').
        """
        s = str(value or "").strip().lower()
        if s in {"yes", "y"}:
            return "Yes"
        if s in {"no", "n"}:
            return "No"
        if "remain" in s:
            return "Remain"
        if "leave" in s:
            return "Leave"
        if "united kingdom" in s:
            return "United Kingdom"
        if "united ireland" in s:
            return "United Ireland"
        if re.search(r"(did\s*not\s*vote|dnv|abstain|boycott)", s):
            return "Did not vote"
        # fall back to capitalised original
        return value if isinstance(value, str) else str(value)

    def _get_comprehensive_party_map(self) -> Dict[str, Dict[str, str]]:
        """Return robust mapping of Party -> {Designation, Position}."""
        
        # Helper to create entry
        def entry(des, pos): return {'designation': des, 'position': pos}
        
        mapping = {
            # UNIONIST
            'DUP': entry('Unionist', '?'),
            'Democratic Unionist Party': entry('Unionist', '?'),
            'Protestant Unionist Party': entry('Unionist', '?'), # Added
            'Independent Unionist': entry('Unionist', '?'), # Added
            'UUP': entry('Unionist', '?'),
            'Ulster Unionist Party': entry('Unionist', '?'),
            'TUV': entry('Unionist', '?'),
            'Traditional Unionist Voice': entry('Unionist', '?'),
            'PUP': entry('Unionist', '?'),
            'Progressive Unionist Party': entry('Unionist', '?'),
            'UKIP': entry('Unionist', '?'),
            'Conservative': entry('Unionist', '?'),
            'NI Conservatives': entry('Unionist', '?'),
            'Heritage Party': entry('Unionist', '?'),
            'NI Labour': entry('Unionist', '?'), # Added
            
            # NATIONALIST
            'Sinn Féin': entry('Nationalist', '?'),
            'SDLP': entry('Nationalist', '?'),
            'Social Democratic and Labour Party': entry('Nationalist', '?'),
            'Aontú': entry('Nationalist', '?'),
            'People Before Profit': entry('Nationalist', '?'), 
            'PBP': entry('Nationalist', '?'),
            'Workers Party': entry('Nationalist', '?'),
            'IRSP': entry('Nationalist', '?'),
            'Republican Sinn Féin': entry('Nationalist', '?'),
            '32 County Sovereignty Movement': entry('Nationalist', '?'),
            'Independent Nationalist': entry('Nationalist', '?'), # Added
            'National Democratic Party': entry('Nationalist', '?'), # Added
            'Nationalist Party': entry('Nationalist', '?'), # Added
            'Republican Labour Party': entry('Nationalist', '?'), # Added
            
            # OTHER / CROSS-COMMUNITY
            'Alliance': entry('Other', 'Neutral'),
            'Alliance Party': entry('Other', 'Neutral'),
            'Green Party': entry('Other', 'Neutral'),
            'Independent': entry('Other', 'Neutral'), # Added
            'Independent Other': entry('Other', 'Neutral'), # Added
            'Ulster Liberal Party': entry('Other', 'Neutral'), # Added
            'Unity': entry('Other', 'Neutral'), # Added
            'Cross-Community Labour Alternative': entry('Other', 'Neutral'),
            'Labour Alternative': entry('Other', 'Neutral'),
            'Socialist Party': entry('Other', 'Neutral'),
            'CISTA': entry('Other', 'Neutral'),
        }
        return mapping
    
    def _get_default_endorsements(self) -> Dict[str, Dict[str, str]]:
        return self._get_comprehensive_party_map()
    
    def get_option_keys(self, endorsements: Dict[str, Dict[str, str]], er_df: pd.DataFrame, date: str) -> Tuple[Set[str], Set[str]]:
        """
        Determine which endorsement positions map to Option 1 vs Option 2.
        Uses actual referendum option names from results data and a mapping table
        to translate endorsement labels to ballot options.
        Returns (opt1_keys, opt2_keys) as sets of position strings.
        """
        # Get actual option names from referendum results
        option1_name, option2_name = self.get_referendum_options(er_df, date)
        
        if not option1_name or not option2_name:
            # Not a referendum or missing data
            logging.warning(f"Could not determine referendum options for {date}")
            return (set(), set())
        
        unique_positions = set(d.get('position', '').lower() for d in endorsements.values())
        logging.info(f"Referendum Options: '{option1_name}' vs '{option2_name}'")
        logging.info(f"Unique Endorsement Positions: {unique_positions}")
        
        opt1_keys = set()
        opt2_keys = set()
        
        # Normalize option names for matching
        opt1_normalized = option1_name.lower()
        opt2_normalized = option2_name.lower()
        
        # Get mapping for this specific referendum if available
        mapping = self.REFERENDUM_ENDORSEMENT_MAPPINGS.get(date, {})
        
        for pos in unique_positions:
            if not pos or pos in ['?', 'neutral', 'nan', '', 'did not vote', 'spoiled', 'boycott']:
                continue
            
            # Try mapping table first
            if mapping:
                if opt1_normalized in mapping and any(keyword in pos for keyword in mapping[opt1_normalized]):
                    opt1_keys.add(pos)
                    continue
                
                if opt2_normalized in mapping and any(keyword in pos for keyword in mapping[opt2_normalized]):
                    opt2_keys.add(pos)
                    continue
            
        logging.info(f"Option 1 '{option1_name}' keys: {opt1_keys}")
        logging.info(f"Option 2 '{option2_name}' keys: {opt2_keys}")
        
        return opt1_keys, opt2_keys

    def _build_temporal_features(self, party: str, constituency: str, target_date: str, 
                                 election_results: pd.DataFrame) -> List[float]:
        """
        Build 8 fixed temporal features for a party at target_date.
        """
        # Get all elections for this party in this constituency before target_date
        party_elections = election_results[
            (election_results['Constituency'] == constituency) &
            (election_results['Party Name'] == party) &
            (election_results['DateStr'] <= target_date) &
            (election_results['ResultType'] == 'Candidate')
        ].sort_values('DateStr').copy()
        
        if party_elections.empty:
            return [0.0] * 8  # No history
        
        # Get election dates and align everything properly
        dates = party_elections['DateStr'].tolist()
        target_dt = pd.to_datetime(target_date)
        
        # Build aligned arrays: for each election date, get party votes and total votes
        shares = []
        years_ago = []
        for i, date in enumerate(dates):
            date_str = str(date)
            # Get party votes
            party_votes = party_elections.iloc[i]['Votes1']
            # Get total votes for this date
            total_votes_data = election_results[
                (election_results['Constituency'] == constituency) &
                (election_results['DateStr'] == date_str) &
                (election_results['ResultType'] == 'Candidate')
            ]
            if total_votes_data.empty:
                continue
            total_votes = total_votes_data['Votes1'].sum()
            if total_votes == 0:
                continue
            
            # Calculate vote share for this date
            share = float(party_votes) / float(total_votes)
            shares.append(share)
            
            # Calculate years ago
            years = (target_dt - pd.to_datetime(date_str)).days / 365.25
            years_ago.append(max(years, 0.01))  # Minimum 0.01 to avoid division by zero
        
        vote_shares = np.array(shares)
        years_ago = np.array(years_ago)
        
        if len(vote_shares) == 0:
            return [0.0] * 8
        
        features = []
        
        # 1. Most recent share
        features.append(vote_shares[-1])
        
        # 2-4. Exponentially weighted averages (different decay rates)
        for lam in [0.1, 0.5, 2.0]:
            if len(vote_shares) > 1:
                weights = np.exp(-lam * years_ago)
                w_avg = np.average(vote_shares, weights=weights)
                features.append(w_avg)
            else:
                features.append(vote_shares[-1])
        
        # 5. Volatility (std dev) of recent 3 elections
        recent_shares = vote_shares[-3:] if len(vote_shares) >= 3 else vote_shares
        features.append(np.std(recent_shares) if len(recent_shares) > 1 else 0.0)
        
        # 6. Trend: change over last 2 elections (annualized)
        if len(vote_shares) >= 2:
            years_diff = years_ago[-1] - years_ago[-2]
            if years_diff > 0.01:
                trend = (vote_shares[-1] - vote_shares[-2]) / years_diff
                features.append(trend)
            else:
                features.append(0.0)
        else:
            features.append(0.0)
        
        # 7-8. Will be filled by caller with position info
        features.append(0.0)  # Placeholder for weighted position
        features.append(0.0)  # Placeholder for interaction
        
        return features

    def build_features_for_constituency(self, 
                                      constituency: str,
                                      election_results: pd.DataFrame,
                                      endorsements: Tuple[Dict[str, Dict[str, str]], Dict[float, Dict[str, str]]],
                                      election_date: str,
                                      census_features: Optional[pd.DataFrame] = None,
                                      option_1_keys: List[str] = None,
                                      option_2_keys: List[str] = None,
                                      include_historical: bool = True,
                                      max_historical_date: str = None) -> pd.Series:
        """Build ML features for a single constituency."""
        
        # Unpack endorsements
        if isinstance(endorsements, tuple):
            party_endorsements, candidate_endorsements = endorsements
        else:
            party_endorsements, candidate_endorsements = endorsements, {}

        # Default keys if not provided
        if option_1_keys is None: option_1_keys = ['yes', 'leave', 'pro-union']
        if option_2_keys is None: option_2_keys = ['no', 'remain', 'pro-unity']
        
        # Filter to this constituency and date
        const_data = election_results[
            (election_results['Constituency'] == constituency) &
            (election_results['DateStr'] == election_date) &
            (election_results['ResultType'] == 'Candidate')
        ].copy()
        
        if const_data.empty:
            # Try to find most recent election if exact date missing
            return pd.Series(dtype=float)
        
        features = {}
        
        # Temporal features - days since first election
        try:
            base_date = pd.Timestamp('1970-06-18')
            current_date = pd.Timestamp(election_date)
            features['days_since_first_election'] = ((current_date - base_date).days) / 10000.0  # Normalize
            features['election_year'] = current_date.year
            features['election_decade'] = (current_date.year - 1970) // 10
        except:
            features['days_since_first_election'] = 0.0
            features['election_year'] = 1970
            features['election_decade'] = 0
        
        # Historical temporal features - all elections before this date
        major_parties = ['DUP', 'UUP', 'SDLP', 'Sinn Féin', 'Alliance']
        
        # ALWAYS initialize ML features to maintain consistent feature space
        # This ensures ~112 features regardless of date conditions
        for party in major_parties:
            party_key = party.lower().replace(' ', '_')
            # Initialize ALL 8 temporal features
            features[f"{party_key}_share_recent"] = 0.0
            features[f"{party_key}_share_exp_decay_slow"] = 0.0
            features[f"{party_key}_share_exp_decay_med"] = 0.0
            features[f"{party_key}_share_exp_decay_fast"] = 0.0
            features[f"{party_key}_volatility_3elec"] = 0.0
            features[f"{party_key}_trend_annual"] = 0.0
            features[f"{party_key}_position_weighted"] = 0.0  # Placeholder
            features[f"{party_key}_share_position_int"] = 0.0  # Placeholder
            # Initialize defection and consistency features
            features[f"{party_key}_defection_rate"] = 0.0
            features[f"{party_key}_defection_adjusted_impact"] = 0.0
            features[f"{party_key}_position_consistency"] = 0.0
        
        # Only add complex historical features if we have sufficient history
        # For very early elections (< 1975), temporal features are too sparse
        enable_complex_temporal = include_historical and (election_date >= '1975-01-01')
        if enable_complex_temporal:
            # Determine the max date to use for historical features
            ref_date = election_date
            if max_historical_date is not None:
                ref_date = max_historical_date
            
            # Build rolling-window temporal features for each party
            for party in major_parties:
                party_key = party.lower().replace(' ', '_')
                temporal_features = self._build_temporal_features(party, constituency, ref_date, election_results)
                
                # Append temporal features with fixed names
                feature_names = [
                    f"{party_key}_share_recent",         # Most recent
                    f"{party_key}_share_exp_decay_slow", # Exp weighted, lambda=0.1
                    f"{party_key}_share_exp_decay_med",  # Exp weighted, lambda=0.5
                    f"{party_key}_share_exp_decay_fast", # Exp weighted, lambda=2.0
                    f"{party_key}_volatility_3elec",     # Std dev of last 3
                    f"{party_key}_trend_annual",         # Annualized trend
                    f"{party_key}_position_weighted",    # Placeholder for share×position
                    f"{party_key}_share_position_int"    # Placeholder for interaction
                ]
                
                for i, feat_name in enumerate(feature_names):
                    features[feat_name] = temporal_features[i]
        elif include_historical:
            # For early elections, only add basic recent share features
            # Determine the max date to use for historical features
            ref_date = election_date
            if max_historical_date is not None:
                ref_date = max_historical_date
                
            # Add only simple recent share features
            for party in major_parties:
                party_key = party.lower().replace(' ', '_')
                temporal_features = self._build_temporal_features(party, constituency, ref_date, election_results)
                # Only use the recent share
                features[f"{party_key}_share_recent"] = temporal_features[0]
        
        # ------------------- BLOC-LEVEL INTERACTION FEATURES -------------------
        # These capture coalition effects that individual party features miss
        
        unionist_parties = ['DUP', 'UUP', 'Traditional Unionist Voice', 'PUP', 'NI Conservatives', 'UKIP']
        nationalist_parties = ['Sinn Féin', 'SDLP', 'Aontú', 'People Before Profit']
        cross_community = ['Alliance', 'Green Party', 'NI21', 'Northern Ireland Labour Representation Committee']
        
        # Calculate bloc strengths using temporal features (recent share weighted by position)
        if include_historical:
            unionist_bloc_strength = 0.0
            nationalist_bloc_strength = 0.0
            cross_bloc_strength = 0.0
            
            for party in unionist_parties:
                if party in major_parties:
                    party_key = party.lower().replace(' ', '_')
                    recent_share = features.get(f"{party_key}_share_recent", 0.0)
                    # Unionist parties tend to align more, use stronger weighting
                    bloc_position = features.get(f"{party_key}_position_weighted", 0.0)
                    unionist_bloc_strength += abs(recent_share) * max(0.0, bloc_position)
            
            for party in nationalist_parties:
                if party in major_parties:
                    party_key = party.lower().replace(' ', '_')
                    recent_share = features.get(f"{party_key}_share_recent", 0.0)
                    bloc_position = features.get(f"{party_key}_position_weighted", 0.0)
                    nationalist_bloc_strength += abs(recent_share) * max(0.0, bloc_position)
            
            for party in cross_community:
                if party in major_parties:
                    party_key = party.lower().replace(' ', '_')
                    recent_share = features.get(f"{party_key}_share_recent", 0.0)
                    # Cross-community often breaks traditional alignments
                    cross_bloc_strength += abs(recent_share) * 0.5  # Lower weight but important
            
            features['unionist_bloc_strength'] = unionist_bloc_strength
            features['nationalist_bloc_strength'] = nationalist_bloc_strength
            features['cross_bloc_strength'] = cross_bloc_strength
            
            # Polarization effect - when both blocs are strong, effects amplify
            features['bloc_polarization'] = unionist_bloc_strength * nationalist_bloc_strength
            
            # Net bloc alignment (helps model detect when one side dominates)
            features['net_bloc_alignment'] = unionist_bloc_strength - nationalist_bloc_strength
        
        # ------------------- PARTY POSITION CONSISTENCY FEATURES -------------------
        # Capture whether parties maintain positions over time (consistent = stronger impact)
        
        # For each party, track position consistency over last 3 elections
        if include_historical:
            for party in major_parties:
                party_key = party.lower().replace(' ', '_')
                
                # Get last 3 election dates for this party
                party_dates = election_results[
                    (election_results['Constituency'] == constituency) &
                    (election_results['Party Name'] == party) &
                    (election_results['DateStr'] <= election_date) &
                    (election_results['ResultType'] == 'Candidate')
                ]['DateStr'].sort_values().tolist()[-3:]
                
                if len(party_dates) >= 2:
                    # Get positions for each of these dates
                    positions = []
                    for date in party_dates:
                        # Find endorsement for this party at this date
                        # This requires caching or recomputing - let's simplify
                        # Use current position as proxy for recent consistency
                        current_pos = features.get(f"{party_key}_position_opt1", 0.0) - \
                                    features.get(f"{party_key}_position_opt2", 0.0)
                        positions.append(current_pos)
                    
                    # Calculate consistency (inverse of variance)
                    if max(positions) > 0:  # Avoid division by zero
                        position_consistency = 1.0 - (np.std(positions) / max(positions))
                        features[f"{party_key}_position_consistency"] = max(0.0, position_consistency)
                    else:
                        features[f"{party_key}_position_consistency"] = 0.0
                else:
                    # Not enough history for consistency
                    features[f"{party_key}_position_consistency"] = 0.0
        
        # Party position features for current referendum (only for referendums, not elections)
        for party in major_parties:
            party_key = party.lower().replace(' ', '_')
            position_value = 0.0  # +1 for opt1, -1 for opt2, 0 for neutral
            
            if party in party_endorsements:
                position = str(party_endorsements[party].get('position', '')).lower()
                designation = str(party_endorsements[party].get('designation', '')).lower()
                
                # Binary position features - let model learn importance
                features[f"{party_key}_position_opt1"] = 1.0 if any(k in position for k in option_1_keys) else 0.0
                features[f"{party_key}_position_opt2"] = 1.0 if any(k in position for k in option_2_keys) else 0.0
                features[f"{party_key}_position_neutral"] = 1.0 if (position == 'neutral' or position == '?') else 0.0
                features[f"{party_key}_position_unknown"] = 1.0 if not position else 0.0
                
                # Designation features
                features[f"{party_key}_designation_unionist"] = 1.0 if 'unionist' in designation else 0.0
                features[f"{party_key}_designation_nationalist"] = 1.0 if 'nationalist' in designation else 0.0
                features[f"{party_key}_designation_other"] = 1.0 if ('other' in designation or 'neutral' in designation) else 0.0
                
                # Determine position value for weighted features (+1, -1, or 0)
                if any(k in position for k in option_1_keys):
                    position_value = 1.0
                elif any(k in position for k in option_2_keys):
                    position_value = -1.0
                else:
                    position_value = 0.0
            else:
                # Fill with zeros if no endorsement data
                features[f"{party_key}_position_opt1"] = 0.0
                features[f"{party_key}_position_opt2"] = 0.0
                features[f"{party_key}_position_neutral"] = 0.0
                features[f"{party_key}_position_unknown"] = 1.0
                features[f"{party_key}_designation_unionist"] = 0.0
                features[f"{party_key}_designation_nationalist"] = 0.0
                features[f"{party_key}_designation_other"] = 1.0
                position_value = 0.0
            
            # Fill in the temporal features (7) and (8) with position-weighted values
            # Feature 7: position_weighted = position_value × recent_share
            # Feature 8: interaction = |position_value| × recent_share (magnitude of alignment)
            if include_historical:
                recent_share = features.get(f"{party_key}_share_recent", 0.0)
                features[f"{party_key}_position_weighted"] = position_value * recent_share
                features[f"{party_key}_share_position_int"] = abs(position_value) * recent_share
        
        # ------------------- CANDIDATE-LEVEL DEFECTION FEATURES -------------------
        # Modeling 2016 UUP split: official Leave but some candidates Remain
        # This captures internal party discord that reduces overall impact
        
        if include_historical:
            # For each major party, calculate defection rate
            for party in major_parties:
                party_key = party.lower().replace(' ', '_')
                
                # Only calculate defection if party has candidates in this constituency
                party_candidates = const_data[const_data['Party Name'] == party]
                if party_candidates.empty:
                    features[f"{party_key}_defection_rate"] = 0.0
                    continue
                
                # Get official party position
                official_pos = 0.0
                if party in party_endorsements:
                    position = str(party_endorsements[party].get('position', '')).lower()
                    if any(k in position for k in option_1_keys):
                        official_pos = 1.0
                    elif any(k in position for k in option_2_keys):
                        official_pos = -1.0
                else:
                    # No official position = no defection possible
                    features[f"{party_key}_defection_rate"] = 0.0
                    continue
                
                # Count defectors (candidates with different position)
                defectors = 0.0
                total_candidates = len(party_candidates)
                
                for _, cand in party_candidates.iterrows():
                    pid = cand.get('PersonID')
                    if pd.notna(pid) and pid in candidate_endorsements:
                        # Candidate has personal endorsement
                        cand_pos = str(candidate_endorsements[pid].get('position', '')).lower()
                        if any(k in cand_pos for k in option_1_keys):
                            cand_val = 1.0
                        elif any(k in cand_pos for k in option_2_keys):
                            cand_val = -1.0
                        else:
                            cand_val = 0.0
                    else:
                        # No candidate endorsement = follows party line
                        cand_val = official_pos
                    
                    # Check if candidate defects from official line
                    if cand_val != official_pos and official_pos != 0.0:
                        defectors += 1.0
                
                # Normalized defection rate (0.0 to 1.0)
                features[f"{party_key}_defection_rate"] = defectors / total_candidates if total_candidates > 0 else 0.0
                
                # Defection-weighted position impact (discord reduces impact)
                # e.g., UUP 0.3 defection rate = 0.7 effective impact
                features[f"{party_key}_defection_adjusted_impact"] = (1.0 - features[f"{party_key}_defection_rate"]) \
                                                                   * abs(official_pos) * features.get(f"{party_key}_share_recent", 0.0)
        
        # 1. Party share features for current election
        total_votes = const_data['Votes1'].sum()
        
        if total_votes == 0:
            return pd.Series(features)
        
        # Initialize counters
        shares = {
            'share_option_1': 0.0,
            'share_option_2': 0.0,
            'share_unaligned': 0.0,
            'share_spoiled_endorsement': 0.0,
            'share_did_not_vote_endorsement': 0.0,
            'share_boycott_endorsement': 0.0,  # Alias for model compatibility
            'share_unionist': 0.0,
            'share_nationalist': 0.0,
            'share_other': 0.0
        }
        
        # Helper to check if candidate stood in last 5 years
        def candidate_active_recently(pid, current_date):
            if pd.isna(pid): return False
            try:
                curr_dt = pd.to_datetime(current_date)
                five_years_ago = curr_dt - pd.DateOffset(years=5)
                
                # Check history
                history = election_results[
                    (election_results['PersonID'] == pid) &
                    (election_results['DateStr'] < current_date) &
                    (election_results['DateStr'] >= five_years_ago.strftime('%Y-%m-%d'))
                ]
                return not history.empty
            except:
                return False

        # Iterate by CANDIDATE (not Party)
        for _, row in const_data.iterrows():
            party = str(row['Party Name']).strip()
            votes = float(row['Votes1'])
            pid = row.get('PersonID')
            share = votes / total_votes
            
            position = 'Neutral'
            designation = 'Other'
            
            # 1. Check Personal Endorsement
            if pd.notna(pid) and pid in candidate_endorsements:
                cand_info = candidate_endorsements[pid]
                position = cand_info.get('position', 'Neutral')
                designation = cand_info.get('designation', 'Other')
                
            # 2. Check Party Endorsement
            elif party in party_endorsements:
                # Fallback to Party
                party_info = party_endorsements[party]
                position = party_info.get('position', 'Neutral')
                designation = party_info.get('designation', 'Other')
            
            # Normalize
            pos = str(position).lower()
            
            # Aggregate
            if any(k in pos for k in option_1_keys):
                shares['share_option_1'] += share
            elif any(k in pos for k in option_2_keys):
                shares['share_option_2'] += share
            elif 'spoiled' in pos:
                shares['share_spoiled_endorsement'] += share
            elif 'did not vote' in pos:
                shares['share_did_not_vote_endorsement'] += share
                shares['share_boycott_endorsement'] += share  # Keep both for compatibility
            else:
                shares['share_unaligned'] += share
                
            # Aggregate by Designation
            if designation == 'Unionist':
                shares['share_unionist'] += share
            elif designation == 'Nationalist':
                shares['share_nationalist'] += share
            else:
                shares['share_other'] += share
        
        # Normalize shares if there are boycotts (convert from Electorate Share to Projected Vote Share)
        did_not_vote_share = shares['share_did_not_vote_endorsement']
        valid_share = 1.0 - did_not_vote_share
        
        if valid_share > 0.01:
            shares['share_option_1'] = shares['share_option_1'] / valid_share
            shares['share_option_2'] = shares['share_option_2'] / valid_share
            shares['share_unaligned'] = shares['share_unaligned'] / valid_share
        
        features.update(shares)
        
        # 2. Historic turnout features
        const_history = election_results[
            (election_results['Constituency'] == constituency) &
            (election_results['ResultType'] == 'Candidate')
        ].copy()
        
        if not const_history.empty:
            # Average turnout in last 5 years
            recent = const_history[const_history['DateStr'] >= '2017-01-01']
            if not recent.empty:
                features['avg_recent_turnout'] = recent.groupby('DateStr')['Votes1'].sum().mean() / 1000
            else:
                features['avg_recent_turnout'] = 0.0
            
            # Votes per capita trends
            total_pop = 100000
            if census_features is not None and not census_features.empty:
                 census_constituency = self._map_constituency_to_census(constituency)
                 match = census_features[census_features['Constituency_clean'] == census_constituency]
                 if not match.empty:
                     total_pop = match['Total_pop'].iloc[0]
            
            features['votes_per_capita'] = total_votes / total_pop
        
        # 3. Census demographics
        if election_date < '1995-01-01':
            # For pre-1995 elections, do not use 2001 census data.
            features.update({
                'catholic_pct': 0.0, 'protestant_pct': 0.0,
                'other_religion_pct': 0.0, 'no_religion_pct': 0.0,
                'mean_age': 0.0, 'age_18_24_pct': 0.0,
                'unemployment_pct': 0.0, 'degree_level_pct': 0.0
            })
        elif census_features is not None and not census_features.empty:
            # Map constituency name to Census 2001 boundaries (handles Belfast South And Mid Down -> Belfast South, etc.)
            census_constituency = self._map_constituency_to_census(constituency)
            const_census = census_features[census_features['Constituency_clean'] == census_constituency]
            if not const_census.empty:
                features.update({
                    'catholic_pct': const_census['Catholic_%'].iloc[0] / 100,
                    'protestant_pct': const_census['Protestant_%'].iloc[0] / 100,
                    'other_religion_pct': const_census['Other_Religion_%'].iloc[0] / 100,
                    'no_religion_pct': const_census['No_Religion_%'].iloc[0] / 100,
                    'mean_age': const_census['Mean_Age'].iloc[0],
                    'age_18_24_pct': (const_census['Age_18_19_%'].iloc[0] + const_census['Age_20_24_%'].iloc[0]) / 100,
                    'unemployment_pct': const_census['Unemployment_%'].iloc[0] / 100,
                    'degree_level_pct': const_census['Degree_Level_%'].iloc[0] / 100,
                })
            else:
                # Fill with defaults if missing
                features.update({
                    'catholic_pct': 0.4, 'protestant_pct': 0.4,
                    'other_religion_pct': 0.05, 'no_religion_pct': 0.15,
                    'mean_age': 38.0, 'age_18_24_pct': 0.12,
                    'unemployment_pct': 0.05, 'degree_level_pct': 0.25
                })
        
        # 4. Competition intensity
        n_parties = len(const_data['Party Name'].unique())
        features['n_parties'] = n_parties
        features['competitiveness'] = 1.0 - (const_data.groupby('Party Name')['Votes1'].sum().max() / total_votes)
        
        return pd.Series(features)

    def get_aggregated_features(self, constituency_group: List[str], er_df: pd.DataFrame, endorsements: pd.DataFrame, date: str, census_features: pd.DataFrame, option_1_keys: List[str] = None, option_2_keys: List[str] = None, max_historical_date: str = None) -> pd.Series:
        """
        Generate features for a group of constituencies (e.g. for AV Ref groups or NI-wide).
        Aggregates features by averaging percentages.
        """
        all_features = []
        
        # If "Northern Ireland" is passed as a single item, we need to expand it to all constituencies
        # present in the election results for that date.
        if len(constituency_group) == 1 and constituency_group[0] == "Northern Ireland":
            # Find all constituencies with results on or before this date
            # This is a bit heuristic, but we can use the unique constituencies in the er_df
            # filtered by date.
            # Better: use get_constituencies_for_date
            constituency_group = self.get_constituencies_for_date(er_df, date)
            
            if not constituency_group:
                logging.warning(f"No constituencies found for NI-wide aggregation on {date} via election results.")
                if census_features is not None and 'Constituency_clean' in census_features.columns:
                    logging.info("Falling back to all Census constituencies.")
                    constituency_group = census_features['Constituency_clean'].unique().tolist()
                else:
                    logging.warning("No Census data available for fallback.")
                    return pd.Series()

        for const in constituency_group:
            feats = self.build_features_for_constituency(const, er_df, endorsements, date, census_features, option_1_keys, option_2_keys)
            if not feats.empty:
                all_features.append(feats)
        
        if not all_features:
            return pd.Series()
            
        # Convert to DataFrame to calculate mean
        df_feats = pd.DataFrame(all_features)
        
        # For now, simple mean is used. 
        # In a perfect world, we'd weight by electorate, but we might not have it for all historic data easily.
        aggregated = df_feats.mean()
        
        return aggregated
    
    def get_constituencies_for_date(self, election_results: pd.DataFrame, target_date: str, result_type: str = 'Candidate') -> List[str]:
        """Get all constituencies that had elections on or before target_date."""
        logging.debug(f"[get_constituencies_for_date] Target date: {target_date}, Result type: {result_type}")
        
        # Find the most recent election date <= target_date
        # If result_type is specified, we should also filter dates by that type to ensure we get relevant dates
        # But for now, let's just find the date first
        all_dates = election_results[
            (election_results['DateStr'] <= target_date) & 
            (election_results['ResultType'] == 'Candidate')
        ]['DateStr'].unique()
        
        logging.debug(f"[get_constituencies_for_date] All candidate election dates <= {target_date}: {sorted(all_dates)}")

        if len(all_dates) == 0:
            logging.warning(f"No elections found on or before {target_date}")
            return []
        
        most_recent_date = sorted(all_dates)[-1]
        logging.info(f"Using election date: {most_recent_date} (most recent <= {target_date})")
        
        # Get all constituencies for that election
        query = (election_results['DateStr'] == most_recent_date)
        if result_type:
            query = query & (election_results['ResultType'] == result_type)
            
        constituencies = election_results[query]['Constituency'].unique().tolist()
        
        logging.info(f"Found {len(constituencies)} constituencies")
        return constituencies
    
    def build_training_data(self, 
                          election_results: pd.DataFrame,
                          endorsements: Dict[str, str],
                          census_features: Optional[pd.DataFrame] = None,
                          min_date: str = '2010-01-01',
                          max_date: str = None) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Build complete training dataset from historical elections and referendum results."""
        
        features_list = []
        targets_list = []
        
        # Get all unique dates with elections
        election_dates = election_results[
            (election_results['ResultType'] == 'Candidate') &
            (election_results['DateStr'] >= min_date)
        ]['DateStr'].unique()
        
        if max_date:
            election_dates = [d for d in election_dates if d <= max_date]
        
        for date in election_dates:
            constituencies = self.get_constituencies_for_date(election_results, date)
            
            for constituency in constituencies:
                # Build features
                features = self.build_features_for_constituency(
                    constituency, election_results, endorsements, date, census_features
                )
                
                if features.empty:
                    continue
                
                features['date'] = date
                features['constituency'] = constituency
                features_list.append(features)
                
                # For training, we'd need actual referendum results
                # For now, create dummy targets or load from historical referendums
                target = self._get_referendum_target(constituency, date, election_results)
                if target:
                    targets_list.append(target)
        
        if not features_list:
            logging.warning("No training data generated")
            return pd.DataFrame(), pd.DataFrame()
        
        X = pd.DataFrame(features_list)
        y = pd.DataFrame(targets_list) if targets_list else pd.DataFrame()
        
        logging.info(f"Built training data: {X.shape[0]} samples, {X.shape[1]} features")
        return X, y
    
    def _get_referendum_target(self, constituency: str, date: str, election_results: pd.DataFrame) -> Optional[Dict[str, float]]:
        """Extract referendum results for training (if available)."""
        
        # Look for referendum results for this constituency and date
        ref_data = election_results[
            (election_results['Constituency'] == constituency) &
            (election_results['DateStr'] == date) &
            (election_results['ResultType'].isin(['Votes', 'Spoiled ballots']))
        ].copy()
        
        if ref_data.empty:
            return None
        
        # Calculate target variables
        targets = {}
        total_votes = 0
        
        for _, row in ref_data.iterrows():
            option = str(row.get('Name usually known by', 'Unknown')).strip()
            votes = row.get('Votes1', 0)
            
            if 'Spoiled' in str(row.get('ResultType', '')):
                targets['spoiled'] = float(votes)
            elif 'Did not vote' in option:
                targets['did_not_vote'] = float(votes)
            elif option and votes > 0:
                # For binary referendums, need to map options
                targets[option] = float(votes)
                total_votes += float(votes)
        
        # Convert to percentages if we have data
        if total_votes > 0:
            for key in targets:
                if key not in ['spoiled', 'did_not_vote']:
                    targets[key] = targets[key] / total_votes
        
        return targets if targets else None