"""moved to tools/extract-pdf-text.py (site restructure, wave 1); this shim keeps old commands and notes working for a month."""
import os
import runpy
import sys

sys.argv[0] = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../tools/extract-pdf-text.py')
runpy.run_path(sys.argv[0], run_name='__main__')
