import pandas as pd
import numpy as np
import logging
from pathlib import Path
from ..config import CFG

logger = logging.getLogger(__name__)

class CorrelationAnalyzer:
    def __init__(self):
        self.er_df = None
        self.census_df = None
        self.census_pivot = None
        self._load_data()

    def _load_data(self):
        if self.er_df is None:
            try:
                # Load Election Results
                # Assuming global data loaded in app context, but for standalone we load here
                # or assume passed in. For now, lazy load from file if not provided.
                # Optimally, this should use the shared data loader in web/data_access.py
                # But to keep this module clean, we'll rely on the caller or load if needed.
                
                # Check if we can import the shared data frame
                from ..web.data_access import CFG_ER_DF
                if CFG_ER_DF is not None:
                    self.er_df = CFG_ER_DF
                else:
                    # Fallback load
                    p = Path('Full election tables.xlsx')
                    if p.exists():
                        self.er_df = pd.read_excel(p, sheet_name='ElectionResults')
                        self.er_df['DateStr'] = pd.to_datetime(self.er_df['Date']).dt.strftime('%Y-%m-%d')
            except Exception as e:
                logger.error(f"Error loading ER data: {e}")

        if self.census_pivot is None:
            try:
                # Check for cached processed census
                cache_path = Path('cleaned_data/census_pivot.parquet')
                if cache_path.exists():
                    self.census_pivot = pd.read_parquet(cache_path)
                else:
                    # Processing raw census is slow, so we warn or try to load
                    # For this environment, we might not have the pivot ready.
                    # Let's try to load the raw and pivot if feasible, or error.
                    # Ideally, this should be pre-computed.
                    pass
            except Exception as e:
                logger.error(f"Error loading Census data: {e}")

    def ensure_census_data(self):
        if self.census_pivot is not None:
            return True
        
        cache_dir = Path('cleaned_data')
        cache_dir.mkdir(exist_ok=True)
        cache_path = cache_dir / 'census_pivot.parquet'
        
        if cache_path.exists():
            try:
                self.census_pivot = pd.read_parquet(cache_path)
                logger.info(f"Loaded census data from cache: {cache_path}")
                return True
            except Exception as e:
                logger.warning(f"Failed to load census cache: {e}")

        # Attempt to load raw and pivot
        try:
            p = Path('Census2001.xlsx')
            if not p.exists():
                return False
            
            logger.info("Processing raw census data (this may take a while)...")
            xl = pd.ExcelFile(p)
            raw = pd.concat([xl.parse(s) for s in xl.sheet_names if 'Normalised' in s])
            
            # Pivot logic similar to analyze_correlations.py
            raw = raw.dropna(subset=['RowLabel1', 'Table', 'ColumnLabel', 'Value'])
            raw['FeatureName'] = raw['Table'].astype(str) + " | " + raw['ColumnLabel'].astype(str)
            
            # Filter for known constituencies (optimization)
            if self.er_df is not None:
                known_consts = set(self.er_df['Constituency'].dropna().unique())
                
                def clean_name(n):
                    return str(n).lower().strip().replace('&','and').replace(' ','_').replace('-','_')
                
                known_clean = {clean_name(c) for c in known_consts}
                raw['RowLabel1_clean'] = raw['RowLabel1'].apply(clean_name)
                raw = raw[raw['RowLabel1_clean'].isin(known_clean)]
            
            self.census_pivot = raw.pivot_table(index='RowLabel1', columns='FeatureName', values='Value', aggfunc='first')
            
            # Clean index for joining
            self.census_pivot.index.name = 'Constituency'
            self.census_pivot['Constituency_clean'] = self.census_pivot.index.map(lambda x: str(x).lower().strip().replace('&','and').replace(' ','_').replace('-','_'))
            
            # Cache it
            try:
                self.census_pivot.to_parquet(cache_path)
                logger.info(f"Cached census data to {cache_path}")
            except Exception as e:
                logger.warning(f"Failed to cache census data: {e}")
            
            return True
        except Exception as e:
            logger.error(f"Failed to process census data: {e}")
            return False

    def get_referendum_correlations(self, ref_name_fragment):
        if self.er_df is None or self.census_pivot is None:
            if not self.ensure_census_data():
                return {"error": "Census data unavailable"}

        # Find referendum
        df = self.er_df
        mask = df['ResultType'] == 'Answer'
        ref_dates = df[mask]['DateStr'].unique()
        
        # Simple match
        target_date = None
        for d in ref_dates:
            # This is a heuristic, needs refinement for exact matching logic
            # For now, we'll assume the caller passes a date or we find one.
            if ref_name_fragment in d: # invalid assumption, date is YYYY-MM-DD
                target_date = d
                break
        
        # If fragment is a name (e.g. 'EU'), look up rows
        if not target_date:
            # Scan rows for name match
            matches = df[df['ElectionTitle'].str.contains(ref_name_fragment, case=False, na=False)]
            if not matches.empty:
                target_date = matches.iloc[0]['DateStr']
        
        if not target_date:
             # Default to 2016 EU if "EU" or "2016"
             if '2016' in ref_name_fragment or 'EU' in ref_name_fragment.upper():
                 target_date = '2016-06-23'

        if not target_date:
            return {"error": "Referendum not found"}

        # Extract Referendum Results
        # This logic mirrors analyze_correlations.py
        ref_rows = df[(df['DateStr'] == target_date) & (df['ResultType'] == 'Answer')]
        
        # Identify options (Yes/No, Remain/Leave)
        options = ref_rows['Name usually known by'].dropna().unique()
        if len(options) < 2:
            return {"error": "Insufficient options found"}
        
        op1, op2 = options[0], options[1] # Naive
        
        data = []
        for const in ref_rows['Constituency'].unique():
             if str(const) == 'nan' or const == 'Northern Ireland': continue
             c_rows = ref_rows[ref_rows['Constituency'] == const]
             
             votes = {op1: 0, op2: 0}
             for _, row in c_rows.iterrows():
                 n = row['Name usually known by']
                 if n == op1: votes[op1] = row['Votes1']
                 elif n == op2: votes[op2] = row['Votes1']
             
             # Get Electorate
             const_all = df[(df['DateStr'] == target_date) & (df['Constituency'] == const)]
             elec = 0
             elec_row = const_all[const_all['ResultType'] == 'Electorate']
             if not elec_row.empty: elec = elec_row['Votes1'].max()
             
             if elec > 0:
                 v1, v2 = votes[op1], votes[op2]
                 total_valid = v1 + v2
                 t_row = const_all[const_all['ResultType'] == 'Turnout']
                 turnout_count = t_row['Votes1'].max() if not t_row.empty else total_valid
                 
                 spoiled = max(0, turnout_count - total_valid)
                 dnv = max(0, elec - turnout_count)
                 
                 data.append({
                     'Constituency': const,
                     op1: (v1/elec),
                     op2: (v2/elec),
                     'Spoiled': (spoiled/elec),
                     'Did not vote': (dnv/elec)
                 })
        
        ref_df = pd.DataFrame(data)
        if ref_df.empty: return {"error": "No constituency data extracted"}
        
        # Clean names for join
        ref_df['Constituency_clean'] = ref_df['Constituency'].apply(
            lambda x: str(x).lower().strip().replace('&','and').replace(' ','_').replace('-','_')
        )
        
        # Merge
        merged = pd.merge(ref_df, self.census_pivot, on='Constituency_clean')
        
        results = {}
        targets = [op1, op2, 'Spoiled', 'Did not vote']
        census_cols = [c for c in self.census_pivot.columns if c != 'Constituency_clean']
        
        for target in targets:
            if target not in merged.columns: continue
            corrs = []
            y = merged[target]
            for c_col in census_cols:
                x = merged[c_col]
                if x.nunique() <= 1: continue
                try:
                    val = y.corr(x)
                    if pd.notna(val):
                        corrs.append({"feature": c_col, "correlation": val})
                except: pass
            
            # Sort absolute
            corrs.sort(key=lambda x: abs(x["correlation"]), reverse=True)
            results[target] = corrs[:20] # Top 20
            
        return results

    def get_party_correlations(self, party_name):
        if self.er_df is None or self.census_pivot is None:
            if not self.ensure_census_data():
                return {"error": "Census data unavailable"}

        # Logic from analyze_correlations.py (Party section)
        df = self.er_df
        party_mask = (df['ResultType'] == 'Candidate') & (df['DateStr'] >= '1995-01-01')
        party_df = df[party_mask].copy()
        
        # Clean party names logic
        def map_party(p):
            p = str(p).lower()
            target = party_name.lower()
            if target in p: return party_name # Simple contains check
            # Add aliases
            if party_name == 'Sinn Féin' and 'sinn' in p: return party_name
            if party_name == 'DUP' and 'democratic unionist' in p: return party_name
            if party_name == 'UUP' and 'ulster unionist' in p: return party_name
            if party_name == 'SDLP' and 'social democratic' in p: return party_name
            return 'Other'

        party_df['Party_Mapped'] = party_df['Party Name'].apply(map_party)
        
        # Calculate Share
        totals = party_df.groupby(['DateStr', 'Constituency'])['Votes1'].sum().reset_index()
        totals.rename(columns={'Votes1': 'TotalValid'}, inplace=True)
        
        p_votes = party_df[party_df['Party_Mapped'] == party_name].groupby(['DateStr', 'Constituency'])['Votes1'].sum().reset_index()
        
        merged = pd.merge(p_votes, totals, on=['DateStr', 'Constituency'])
        merged['Share'] = merged['Votes1'] / merged['TotalValid']
        
        # Average over time per constituency
        avg_share = merged.groupby('Constituency')['Share'].mean().reset_index()
        
        if avg_share.empty:
            return {"error": f"No data found for party {party_name}"}
            
        avg_share['Constituency_clean'] = avg_share['Constituency'].apply(
            lambda x: str(x).lower().strip().replace('&','and').replace(' ','_').replace('-','_')
        )
        
        combined = pd.merge(avg_share, self.census_pivot, on='Constituency_clean')
        
        corrs = []
        census_cols = [c for c in self.census_pivot.columns if c != 'Constituency_clean']
        y = combined['Share']
        
        for c_col in census_cols:
            x = combined[c_col]
            if x.nunique() <= 1: continue
            try:
                val = y.corr(x)
                if pd.notna(val):
                    corrs.append({"feature": c_col, "correlation": val})
            except: pass
            
        corrs.sort(key=lambda x: abs(x["correlation"]), reverse=True)
        return {"party": party_name, "correlations": corrs[:50]}
