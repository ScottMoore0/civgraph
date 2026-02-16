"""
High-performance caching for Excel dataframes using Joblib/Parquet.
"""
import os
import hashlib
import joblib
import pandas as pd
import time
from pathlib import Path

CACHE_DIR = Path(".cache/excel")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

def _get_cache_key(file_path):
    """Generate a unique cache key based on file path and modification time."""
    if not os.path.exists(file_path):
        return None
    mtime = os.path.getmtime(file_path)
    raw_key = f"{file_path}:{mtime}"
    return hashlib.md5(raw_key.encode()).hexdigest()

def get_cached_excel_data(file_path):
    """Try to load cached dataframes."""
    key = _get_cache_key(file_path)
    if not key:
        return None
        
    cache_file = CACHE_DIR / f"{key}.joblib"
    if cache_file.exists():
        try:
            # print(f"[Cache] Loading {file_path} from {cache_file}...", flush=True)
            return joblib.load(cache_file)
        except Exception:
            return None
    return None

def cache_excel_data(file_path, data_dict):
    """Cache dictionary of dataframes."""
    key = _get_cache_key(file_path)
    if not key:
        return
        
    cache_file = CACHE_DIR / f"{key}.joblib"
    try:
        # print(f"[Cache] Saving {file_path} to {cache_file}...", flush=True)
        joblib.dump(data_dict, cache_file, compress=3)
    except Exception:
        pass

def preload_excel_data(file_paths):
    """Preload list of files into cache if needed."""
    for path in file_paths:
        if not os.path.exists(path):
            continue
        
        # Check if valid cache exists
        if get_cached_excel_data(path) is not None:
            continue
            
        # Load and cache
        print(f"[Cache] Preloading {path}...", flush=True)
        try:
            xl = pd.ExcelFile(path)
            data = {sheet: xl.parse(sheet) for sheet in xl.sheet_names}
            cache_excel_data(path, data)
        except Exception as e:
            print(f"[Cache] Failed to preload {path}: {e}")
