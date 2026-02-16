#!/usr/bin/env python3
"""
Run cross-validation in a separate process to avoid GIL blocking.
Called via subprocess from the SSE endpoint.
"""

import sys
import json
import pandas as pd
import os
import time
import datetime

# CRITICAL: Force unbuffered output immediately
sys.stdout.flush = lambda: sys.stdout.buffer.flush()

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

def print_event(event_type, data_dict):
    """Print event with CRITICAL immediate flush"""
    msg = f"EVENT: {json.dumps({'event': event_type, 'data': data_dict})}\n"
    sys.stdout.write(msg)
    sys.stdout.flush()  # Force OS-level flush immediately

def print_progress(message):
    """Print progress message with timestamp"""
    timestamp = datetime.datetime.now().strftime("%H:%M:%S")
    print_event("progress", {"log": f"[{timestamp}] {message}"})

def main():
    start_time = datetime.datetime.now()
    
    if len(sys.argv) < 2:
        error_msg = "ERROR: No data file provided"
        sys.stderr.write(error_msg + "\n")
        sys.stderr.flush()
        sys.exit(1)
    
    data_file = sys.argv[1]
    results_file = data_file + ".results"
    
    try:
        # CRITICAL: Send FIRST event immediately - this proves connection is alive
        print_progress("Starting validation process...")
        
        # Load data from temp file
        print_progress("Loading data from disk...")
        
        with open(data_file, 'r') as f:
            data = json.load(f)
        
        # CRITICAL: Send event BEFORE slow pandas operations
        print_progress("Deserializing DataFrames...")
        
        # Deserialize DataFrames (can be slow for large data)
        er_df = pd.read_json(data["er_data"], orient='records')
        tr_df = pd.read_json(data["tr_data"], orient='records')
        
        print_progress(f"Data loaded: {len(er_df)} election results, {len(tr_df)} transfer records")
        
        # Import validator
        from ni_votes.validation import CrossValidator
        
        # Create validator (this is fast)
        print_progress("Creating validator...")
        validator = CrossValidator(er_df, tr_df, k_folds=5)
        
        # CRITICAL: Progress callback that prints events
        def progress_callback(msg):
            message = str(msg) if isinstance(msg, str) else msg.get("message", str(msg))
            print_progress(message)
        
        # Run initialization (this can take time but emits events)
        validator.initialize(progress_callback)
        
        print_progress(f"Found {validator.get_election_count()} eligible elections")
        
        # Run full validation
        if validator.get_election_count() > 0:
            print_progress("Starting full validation...")
            
            results = validator.run_full_validation(
                method="chronological",
                progress_callback=progress_callback
            )
            
            # CRITICAL: Send progress updates during final processing
            print_progress("Validation complete! Processing final results...")
            
            # EMERGENCY FIX: Serialize JSON to file immediately
            print_progress("Serializing results...")
            result_json = json.dumps(results)
            json_size_mb = len(result_json) / (1024 * 1024)
            
            elapsed = datetime.datetime.now() - start_time
            minutes = elapsed.total_seconds() / 60
            
            print_progress(f"Processing complete in {minutes:.1f} minutes")
            print_progress(f"Results size: {json_size_mb:.1f} MB, saving to file...")
            
            # Save results to temp file - this is INSTANT and prevents data loss
            with open(results_file, 'w') as f:
                f.write(result_json)
            
            print_progress("Results saved successfully!")
            
            # Send completion with file path - very small message
            summary_result = {
                "status": "complete",
                "elections_used": len(results.get("folds", [])),
                "folds_used": results.get("folds_used", 0),
                "json_size_mb": round(json_size_mb, 2),
                "results_file": results_file
            }
            
            print_progress("Sending completion signal...")
            sys.stdout.write(f"COMPLETE: {json.dumps(summary_result)}\n")
            sys.stdout.flush()
        
    except Exception as e:
        import traceback
        error_msg = f"ERROR: {str(e)}"
        sys.stderr.write(error_msg + "\n")
        sys.stderr.flush()
        error_data = {'message': str(e), 'details': traceback.format_exc()}
        sys.stdout.write(f"ERROR: {json.dumps(error_data)}\n")
        sys.stdout.flush()
        sys.exit(1)

if __name__ == "__main__":
    main()
