import pandas as pd
import numpy as np
import logging

logger = logging.getLogger(__name__)

class TrendAnalyzer:
    def __init__(self, er_df):
        self.er_df = er_df

    def get_party_vote_history(self, party_name):
        """
        Get the vote history for a specific party over time.
        Returns list of {date, votes, share, total_valid}.
        """
        if self.er_df is None or self.er_df.empty:
            return {"error": "No election data available"}

        df = self.er_df.copy()
        
        # Ensure DateStr
        if 'DateStr' not in df.columns:
             df['DateStr'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')

        # Filter for Candidates
        cand_df = df[df['ResultType'] == 'Candidate']
        
        # Calculate Totals per Election
        totals = cand_df.groupby('DateStr')['Votes1'].sum().reset_index()
        totals.rename(columns={'Votes1': 'TotalValid'}, inplace=True)
        
        # Filter for Party
        # Fuzzy match logic from correlations.py
        def map_party(p):
            p = str(p).lower()
            target = party_name.lower()
            if target in p: return True
            # Aliases
            if party_name == 'Sinn Féin' and 'sinn' in p: return True
            if party_name == 'DUP' and 'democratic unionist' in p: return True
            if party_name == 'UUP' and 'ulster unionist' in p: return True
            if party_name == 'SDLP' and 'social democratic' in p: return True
            return False

        party_mask = cand_df['Party Name'].apply(map_party)
        party_df = cand_df[party_mask]
        
        if party_df.empty:
            return {"party": party_name, "history": []}
            
        # Group by Date
        party_votes = party_df.groupby('DateStr')['Votes1'].sum().reset_index()
        
        # Merge
        merged = pd.merge(party_votes, totals, on='DateStr')
        merged['Share'] = (merged['Votes1'] / merged['TotalValid']) * 100
        
        history = []
        for _, row in merged.sort_values('DateStr').iterrows():
            history.append({
                "date": row['DateStr'],
                "votes": float(row['Votes1']),
                "share": float(row['Share']),
                "total_valid": float(row['TotalValid'])
            })
            
        return {
            "party": party_name,
            "history": history
        }
