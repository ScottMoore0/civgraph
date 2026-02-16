import sys
import os
import pandas as pd
import numpy as np
from datetime import datetime

# Ensure project root is in path
sys.path.insert(0, os.getcwd())

def test_simulation():
    print("="*60)
    print("FINAL VERIFICATION: Simulation Engine Test")
    print("="*60)
    
    try:
        # 1. Load Transfer Model
        from ni_votes.features.transfers_enhanced_robust import get_robust_transfer_model
        model = get_robust_transfer_model()
        
        # Check if trained model exists
        if os.path.exists("robust_transfer_model.joblib"):
            model.load_model("robust_transfer_model.joblib")
            print("✓ RobustTransferModel loaded from cache.")
        else:
            print("! robust_transfer_model.joblib not found. Skipping full simulation test (requires training).")
            return

        # 2. Mock Scenario Data
        scenario = {
            'names': ['Candidate A', 'Candidate B', 'Candidate C'],
            'parties': ['Party X', 'Party Y', 'Party Z'],
            'first_prefs': [5000, 4000, 3000],
            'seats': 1,
            'quota': 6001,
            'constituency': 'Test Constituency',
            'date': '2024-01-01',
            '_prebuilt_model': model,
            'debug_mode': True
        }
        
        # 3. Run Simulation
        from ni_votes.simulate.engine import run_scenario
        
        # Mock DataFrames (not used if _prebuilt_model is provided, but required by signature)
        er_df = pd.DataFrame()
        tr_df = pd.DataFrame()
        
        print("Running single-seat simulation...")
        result = run_scenario(er_df, tr_df, scenario)
        
        if 'counts_meta' in result and len(result['counts_meta']) > 0:
            print("✓ Simulation ran successfully.")
            print(f"  Rounds: {len(result['counts_meta'])}")
            print(f"  Winner: {result['rows'][0][0]}") # Check first row name
        else:
            print("X Simulation failed (no counts produced).")
            
        # 4. Test Multi-Seat
        print("\nRunning multi-seat simulation (STV)...")
        scenario['seats'] = 2
        scenario['quota'] = 4001
        result_stv = run_scenario(er_df, tr_df, scenario)
        
        if 'counts_meta' in result_stv and len(result_stv['counts_meta']) > 0:
             print("✓ STV Simulation ran successfully.")
        else:
             print("X STV Simulation failed.")

    except Exception as e:
        print(f"X Test Failed with Exception: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_simulation()
