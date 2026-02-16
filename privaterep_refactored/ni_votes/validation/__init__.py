"""
Cross-validation module for NI Votes scenario builder.

Validates the ML model and STV simulation engine against historical elections.
"""

from .cross_validator_enhanced_final import CrossValidatorEnhanced as CrossValidator
from .cross_validator_enhanced_final import get_enhanced_cross_validator

__all__ = ["CrossValidator", "get_enhanced_cross_validator"]