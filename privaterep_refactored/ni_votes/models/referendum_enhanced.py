"""
ENHANCED REFERENDUM SIMULATOR with Census Integration

Integrates Census 2001 demographic data with party endorsement model
to improve referendum projection accuracy.
"""

import sys
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO, format='%(message)s')

sys.path.insert(0, '.')
from ni_votes.models.referendum_model import SimpleEndorsementModel


class CensusDataLoader:
    """Loads and processes Census 2001 data for constituency demographics."""
    
    def __init__(self, census_path: str = 'ni_votes/Census2001.xlsx'):
        self.census_path = census_path
        self.demographics = {}  # constituency -> {metric: value}
        self._load_key_demographics()
    
    def _load_key_demographics(self):
        """Extract key demographic variables from Census data."""
        logging.info("Loading Census 2001 data...")
        
        try:
            census_xl = pd.ExcelFile(self.census_path)
            
            # Load both sheets
            df1 = census_xl.parse('Normalised 1')
            df2 = census_xl.parse('Normalised 2')
            df = pd.concat([df1, df2], ignore_index=True)
            
            logging.info(f"Total census records: {len(df):,}")
            
            # Extract constituency-level data
            self._extract_religious_composition(df)
            self._extract_age_demographics(df)
            self._extract_education_levels(df)
            self._extract_employment_status(df)
            
            logging.info(f"Loaded demographics for {len(self.demographics)} constituencies")
            
        except Exception as e:
            logging.error(f"Failed to load Census data: {e}")
    
    def _extract_religious_composition(self, df: pd.DataFrame):
        """Extract religious composition by constituency."""
        # Look for tables on religion
        religion_tables = df[df['Table'].str.contains('RELIGION|RELIGIOUS', case=False, na=False)]
        
        # Find constituency-level data (not Northern Ireland-wide)
        const_religion = religion_tables[
            religion_tables['RowLabel1'].isin(['Belfast East', 'Belfast North', 'Belfast South', 
                                             'Belfast West', 'East Antrim', 'East Londonderry',
                                             'Fermanagh and South Tyrone', 'Foyle', 'Lagan Valley',
                                             'Mid Ulster', 'Newry and Armagh', 'North Antrim',
                                             'North Down', 'South Antrim', 'South Down',
                                             'Strangford', 'Upper Bann', 'West Tyrone'])
        ]
        
        if const_religion.empty:
            logging.warning("No constituency-level religious data found")
            return
        
        # Extract Catholic, Protestant, No Religion percentages
        for _, row in const_religion.iterrows():
            constituency = row['RowLabel1']
            table = row['Table']
            row_label2 = str(row['RowLabel2'])
            col_label = str(row['ColumnLabel'])
            value = row['Value']
            
            if constituency not in self.demographics:
                self.demographics[constituency] = {}
            
            # Extract based on table patterns
            if 'RELIGION' in table and ('Catholic' in row_label2 or 'Catholic' in col_label):
                self.demographics[constituency]['catholic_pct'] = value
            elif 'RELIGION' in table and ('Protestant' in row_label2 or 'Protestant' in col_label):
                self.demographics[constituency]['protestant_pct'] = value
            elif 'RELIGION' in table and ('None' in row_label2 or 'No religion' in col_label):
                self.demographics[constituency]['no_religion_pct'] = value
        
        logging.info(f"  - Religious composition extracted")
    
    def _extract_age_demographics(self, df: pd.DataFrame):
        """Extract age distribution data."""
        age_tables = df[df['Table'].str.contains('AGE', case=False, na=False)]
        
        # Look for median age or age groups
        for _, row in age_tables.iterrows():
            constituency = row['RowLabel1']
            if constituency in ['Northern Ireland']:
                continue
            
            if constituency not in self.demographics:
                self.demographics[constituency] = {}
            
            # Extract working age population percentage (approximation)
            if 'working age' in str(row['RowLabel2']).lower():
                self.demographics[constituency]['working_age_pct'] = row['Value']
        
        logging.info(f"  - Age demographics extracted")
    
    def _extract_education_levels(self, df: pd.DataFrame):
        """Extract education qualification levels."""
        edu_tables = df[df['Table'].str.contains('QUALIFICATION|EDUCATION', case=False, na=False)]
        
        for _, row in edu_tables.iterrows():
            constituency = row['RowLabel1']
            if constituency in ['Northern Ireland']:
                continue
            
            if constituency not in self.demographics:
                self.demographics[constituency] = {}
            
            # Extract degree-level qualification percentage
            if 'degree' in str(row['ColumnLabel']).lower() or 'degree' in str(row['RowLabel2']).lower():
                self.demographics[constituency]['degree_pct'] = row['Value']
        
        logging.info(f"  - Education levels extracted")
    
    def _extract_employment_status(self, df: pd.DataFrame):
        """Extract employment/unemployment rates."""
        emp_tables = df[df['Table'].str.contains('ECONOMIC|EMPLOYMENT', case=False, na=False)]
        
        for _, row in emp_tables.iterrows():
            constituency = row['RowLabel1']
            if constituency in ['Northern Ireland']:
                continue
            
            if constituency not in self.demographics:
                self.demographics[constituency] = {}
            
            # Extract unemployment rate
            if 'unemployed' in str(row['RowLabel2']).lower():
                self.demographics[constituency]['unemployment_pct'] = row['Value']
        
        logging.info(f"  - Employment status extracted")
    
    def get_constituency_demographics(self, constituency: str) -> Dict[str, float]:
        """Get all demographic metrics for a constituency."""
        base = self.demographics.get(constituency, {})
        
        # Provide defaults for missing values
        defaults = {
            'catholic_pct': 45.0,
            'protestant_pct': 45.0,
            'no_religion_pct': 10.0,
            'degree_pct': 20.0,
            'working_age_pct': 65.0,
            'unemployment_pct': 5.0
        }
        
        # Merge with actual data (actual overrides defaults)
        return {**defaults, **base}


class EnhancedReferendumModel(SimpleEndorsementModel):
    """
    Enhanced referendum model integrating Census demographics.
    
    Formula:
    option_score = Σ [party_share × endorsement_weight × (1 + demographic_modifier)]
    
    Demographic modifiers:
    - Higher education → More cross-community voting (reduces tribal endorsement effect)
    - Higher unemployment → More protest voting (amplifies contrarian endorsements)
    - Religious composition → Baseline tribal alignment
    """
    
    def __init__(self, impact_factor: float = 1.2, demographic_weight: float = 0.3):
        super().__init__(impact_factor=impact_factor)
        
        self.demographic_weight = demographic_weight
        self.census_loader = CensusDataLoader()
        self.demographic_modifiers = {}  # constituency -> modifier per option
        
        logging.info("EnhancedReferendumModel initialized with Census integration")
    
    def _calculate_demographic_modifier(self, 
                                      constituency: str, 
                                      option: str,
                                      party: str) -> float:
        """
        Calculate how much demographics modify a party's endorsement impact.
        
        Args:
          constituency: Constituency name
          option: Referendum option (e.g., 'Leave', 'Remain')
          party: Party name
          
        Returns:
          Multiplier (e.g., 1.0 = no change, 1.2 = 20% boost, 0.9 = 10% reduction)
        """
        # Get demographic data
        demo = self.census_loader.get_constituency_demographics(constituency)
        
        # Base modifier is 1.0 (no effect)
        base_modifier = 1.0
        
        # Education effect: higher education = less tribal voting
        if demo['degree_pct'] > 25:  # Above average education
            # Reduces impact of traditional party endorsements
            education_effect = 1.0 - (self.demographic_weight * 0.3)
            base_modifier *= max(0.7, education_effect)
        
        # Unemployment effect: higher unemployment = more protest voting
        if demo['unemployment_pct'] > 7:  # High unemployment
            # Amplifies contrarian endorsements (e.g., anti-establishment)
            protest_boost = 1.0 + (self.demographic_weight * 0.4)
            base_modifier *= min(1.5, protest_boost)
        
        # Religious composition baseline alignment
        # (This creates a subtle baseline effect but doesn't override party alignment)
        if option == 'Leave':
            # Slightly higher Leave tendency in Protestant areas
            baseline = demo['protestant_pct'] / (demo['protestant_pct'] + demo['catholic_pct'])
            baseline_effect = 0.5 + (baseline * 0.5)  # 0.5-1.0 range
            base_modifier *= (0.95 + baseline_effect * 0.05)  # Very subtle
        
        elif option == 'Remain':
            # Slightly higher Remain tendency in Catholic areas
            baseline = demo['catholic_pct'] / (demo['protestant_pct'] + demo['catholic_pct'])
            baseline_effect = 0.5 + (baseline * 0.5)  # 0.5-1.0 range
            base_modifier *= (0.95 + baseline_effect * 0.05)  # Very subtle
        
        return base_modifier
    
    def predict(self, 
              constituencies: List[str], 
              party_shares: Dict[str, Dict[str, float]],
              include_demographics: bool = True) -> Dict[str, Dict[str, float]]:
        """
        Project referendum results with optional demographic integration.
        
        Args:
          constituencies: List of constituency_date keys
          party_shares: {constituency_date: {party: vote_share}}
          include_demographics: Whether to apply demographic modifiers
        """
        if not self.is_fitted:
            raise ValueError("Model must be fitted first")
        
        results = {}
        
        for constituency_key in constituencies:
            # Extract just the constituency name (remove date)
            const_name = constituency_key.split('_')[0]
            
            shares = party_shares.get(constituency_key, {})
            if not shares:
                logging.warning(f"No party shares for {constituency_key}")
                continue
            
            option_scores = {}
            demographic_modifiers_used = {}
            
            for party, vote_share in shares.items():
                if party in self.endorsements:
                    option = self.endorsements[party]
                    
                    # Base endorsement impact
                    weighted_share = vote_share * self.impact_factor
                    
                    # Apply demographic modifier if enabled
                    if include_demographics:
                        modifier = self._calculate_demographic_modifier(
                            const_name, option, party
                        )
                        weighted_share *= modifier
                        demographic_modifiers_used[option] = modifier
                    
                    option_scores[option] = option_scores.get(option, 0) + weighted_share
            
            # Normalize to percentages
            total = sum(option_scores.values()) or 1.0
            results[constituency_key] = {opt: score/total for opt, score in option_scores.items()}
            
            # Log demographic effects for first few constituencies
            if len(results) <= 3 and include_demographics and demographic_modifiers_used:
                logging.debug(f"  {const_name}: Demographic modifiers applied")
                for opt, mod in demographic_modifiers_used.items():
                    logging.debug(f"    {opt}: {mod:.3f}x")
        
        return results


def run_comparison_projection(election_date: str, endorsement_type: str):
    """
    Run both simple and enhanced models for comparison.
    """
    logging.info("=" * 70)
    logging.info("COMPARING SIMPLE vs ENHANCED REFERENDUM MODELS")
    logging.info("=" * 70)
    logging.info("")
    
    # Load data
    xl = pd.ExcelFile('Full election tables.xlsx')
    from ni_votes.data.loading import load_election_results
    
    er_df = load_election_results(xl)
    er_df['name_date'] = er_df['Constituency'] + '_' + er_df['DateStr']
    
    # Get party shares
    election_data = er_df[(er_df['DateStr'] == election_date) & (er_df['ResultType'] == 'Candidate')].copy()
    election_data = election_data[election_data['Votes1'] > 0]
    
    party_shares = {}
    for const in election_data['Constituency'].unique():
        const_data = election_data[election_data['Constituency'] == const]
        total_votes = const_data['Votes1'].sum()
        
        if total_votes == 0:
            continue
        
        shares = {}
        for party, votes in const_data.groupby('Party Name')['Votes1'].sum().items():
            shares[party] = votes / total_votes
        
        key = f"{const}_{election_date}"
        party_shares[key] = shares
    
    # Get endorsements
    if endorsement_type == 'brexit':
        from ni_votes.models.referendum_model import create_brexit_endorsements as get_endorsements
    else:
        from ni_votes.models.referendum_model import create_protocol_endorsements as get_endorsements
    
    endorsements = get_endorsements()
    
    # Run simple model
    simple_model = SimpleEndorsementModel(impact_factor=1.2)
    simple_model.endorsements = endorsements
    simple_model.fit([])
    
    constituencies = list(party_shares.keys())
    simple_results = simple_model.predict(constituencies, party_shares)
    
    # Run enhanced model
    enhanced_model = EnhancedReferendumModel(impact_factor=1.2, demographic_weight=0.3)
    enhanced_model.endorsements = endorsements
    enhanced_model.fit([])
    
    enhanced_results = enhanced_model.predict(constituencies, party_shares, include_demographics=True)
    
    # Compare results
    options = sorted(set(endorsements.values()))
    
    print(f"Constituency-Level Comparison ({len(constituencies)} constituencies)")
    print("=" * 70)
    print(f"{'Constituency':<20} {'Model':<12} {'Leave%':<8} {'Remain%':<8} {'Margin':<8}")
    print("=" * 70)
    
    total_simple = {opt: 0 for opt in options}
    total_enhanced = {opt: 0 for opt in options}
    
    for i, const_key in enumerate(sorted(constituencies)[:10]):  # Show first 10
        const_name = const_key.split('_')[0]
        
        # Simple model
        simple = simple_results.get(const_key, {})
        simple_total = sum(simple.values()) or 1.0
        simple_leave = (simple.get('Leave', 0) / simple_total) * 100
        simple_remain = (simple.get('Remain', 0) / simple_total) * 100
        simple_margin = abs(simple_leave - simple_remain)
        
        if i == 0:  # Header for first row
            print(f"{const_name:<20} {'Simple':<12} {simple_leave:<8.1f} {simple_remain:<8.1f} {simple_margin:<8.1f}")
        else:
            print(f"{const_name:<20} {'Simple':<12} {simple_leave:<8.1f} {simple_remain:<8.1f} {simple_margin:<8.1f}")
        
        # Enhanced model (if different)
        enhanced = enhanced_results.get(const_key, {})
        enhanced_total = sum(enhanced.values()) or 1.0
        enhanced_leave = (enhanced.get('Leave', 0) / enhanced_total) * 100
        enhanced_remain = (enhanced.get('Remain', 0) / enhanced_total) * 100
        enhanced_margin = abs(enhanced_leave - enhanced_remain)
        
        if abs(enhanced_leave - simple_leave) > 0.5 or abs(enhanced_remain - simple_remain) > 0.5:
            print(f"{'':<20} {'Enhanced':<12} {enhanced_leave:<8.1f} {enhanced_remain:<8.1f} {enhanced_margin:<8.1f}")
        
        # Accumulate totals
        for opt in options:
            total_simple[opt] += simple.get(opt, 0)
            total_enhanced[opt] += enhanced.get(opt, 0)
    
    print("...")
    print("=" * 70)
    
    # Overall comparison
    print("\nOverall Result Comparison:")
    simple_total_votes = sum(total_simple.values())
    enhanced_total_votes = sum(total_enhanced.values())
    
    for opt in sorted(options):
        if simple_total_votes > 0:
            simple_pct = (total_simple[opt] / simple_total_votes) * 100
        else:
            simple_pct = 0
        
        if enhanced_total_votes > 0:
            enhanced_pct = (total_enhanced[opt] / enhanced_total_votes) * 100
        else:
            enhanced_pct = 0
        
        diff = enhanced_pct - simple_pct
        print(f"  {opt}: Simple={simple_pct:.1f}%, Enhanced={enhanced_pct:.1f}%, Diff={diff:+.1f}%")
    
    print()
    winner_simple = max(total_simple, key=total_simple.get) if total_simple else "N/A"
    winner_enhanced = max(total_enhanced, key=total_enhanced.get) if total_enhanced else "N/A"
    
    print(f"Winner: Simple={winner_simple}, Enhanced={winner_enhanced}")
    
    if winner_simple != winner_enhanced:
        print("*** DEMOGRAPHIC DATA FLIPPED THE RESULT! ***")
    else:
        print("Demographic data refined but didn't change winner.")
    
    return simple_results, enhanced_results


if __name__ == "__main__":
    # Test with 2022 data
    print("\nRunning referendum simulator...")
    
    simple_results, enhanced_results = run_comparison_projection('2022-05-05', 'brexit')
    
    print("\nModels ready for use!")
    print("\nUsage:")
    print("  simple_model = SimpleEndorsementModel()")
    print("  enhanced_model = EnhancedReferendumModel()")