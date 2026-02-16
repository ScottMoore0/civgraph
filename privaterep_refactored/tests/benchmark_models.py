import pandas as pd
import numpy as np
from ni_votes.features.transfers_enhanced_robust import get_robust_transfer_model
from ni_votes.models.ml_referendum_model_corrected import CorrectedReferendumPredictor
import time

def benchmark_models():
    print("Benchmarking Models...")
    
    # 1. Test Transfer Model Feature Extraction Speed (Vectorized vs Scalar)
    print("\n[Transfer Model] Testing Feature Extraction Speed")
    model = get_robust_transfer_model()
    
    # Create dummy context
    N_CANDIDATES = 20
    N_SURVIVORS = 10
    
    election_ctx = {
        'names': [f"C{i}" for i in range(N_CANDIDATES)],
        'parties': ["PartyA" if i%2==0 else "PartyB" for i in range(N_CANDIDATES)],
        'first_prefs': np.random.randint(100, 5000, N_CANDIDATES).tolist()
    }
    count_ctx = {
        'current_votes': np.random.randint(100, 5000, N_CANDIDATES).tolist(),
        'quota': 6000,
        'count_number': 2
    }
    
    # Warmup
    model._extract_features(0, [1,2], election_ctx, count_ctx)
    
    start = time.time()
    # Simulate 1000 transfer events
    for _ in range(1000):
        survivors = np.random.choice(range(1, N_CANDIDATES), N_SURVIVORS, replace=False)
        model._extract_features(0, survivors, election_ctx, count_ctx)
    end = time.time()
    
    print(f"Vectorized Extraction (1000 calls, {N_SURVIVORS} survivors): {end-start:.4f}s")
    
    # 2. Test Referendum Model Training Speed
    print("\n[Referendum Model] Testing Training Speed (Small Sample)")
    ref_model = CorrectedReferendumPredictor()
    
    # Dummy data (100 samples, 20 features)
    X = pd.DataFrame(np.random.rand(100, 20), columns=[f"feat_{i}" for i in range(20)])
    y = pd.DataFrame(np.random.rand(100, 14), columns=ref_model.base_targets) # 14 targets
    
    start = time.time()
    # Mock feature selection to avoid f_regression overhead on random data
    ref_model.scaler.fit(X)
    X_scaled = ref_model.scaler.transform(X)
    
    # Train one target
    target = ref_model.base_targets[0]
    ref_model._create_ensemble(X_scaled, y[target].values, target, ref_model.pre_optimized_params)
    end = time.time()
    
    print(f"Ensemble Training (100 samples): {end-start:.4f}s")

if __name__ == "__main__":
    benchmark_models()
