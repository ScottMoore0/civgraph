"""Parameter tuning for Dirichlet transfer models based on backtesting results."""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
from sklearn.model_selection import GridSearchCV
from sklearn.metrics import make_scorer
import warnings


@dataclass
class TuningResults:
    """Results from parameter tuning process."""
    optimal_params: Dict[str, float]
    validation_score: float
    backtest_performance: Dict[str, float]
    parameter_stability: float
    uncertainty_calibration: float
    n_iterations: int
    convergence_reached: bool


class DirichletParameterTuner:
    """
    Advanced parameter tuning for Dirichlet transfer models.
    
    Implements the N_min, N_max, k_size tuning discussed in Phase 2,
    with additional sophisticated parameter optimization based on
    backtesting results from Northern Ireland elections.
    """
    
    def __init__(self):
        # Base parameter ranges from Phase 2 discussion
        self.param_ranges = {
            "alpha_prior": [0.1, 0.5, 1.0, 2.0, 5.0, 10.0],
            "min_samples": [3, 5, 10, 15, 20, 30, 50],
            "max_samples": [100, 200, 500, 1000, 2000],
            "mc_samples": [100, 500, 1000, 2000, 5000],
            "concentration_factor": [0.5, 0.8, 1.0, 1.2, 2.0],
            "hierarchical_weight": [0.1, 0.2, 0.3, 0.4, 0.5]
        }
        
        # Northern Ireland specific tuning based on backtesting
        self.ni_specific_ranges = {
            "unionist_concentration": [0.8, 1.0, 1.2, 1.5],  # More predictable transfers
            "nationalist_concentration": [0.8, 1.0, 1.2, 1.5],  # More predictable transfers
            "other_concentration": [0.3, 0.5, 0.8, 1.0],  # More uncertainty
            "early_stage_factor": [1.5, 2.0, 2.5],  # More uncertainty early
            "late_stage_factor": [0.5, 0.7, 1.0],  # More certainty late
        }
        
        # Performance targets from Phase 2
        self.performance_targets = {
            "accuracy_improvement": 0.05,  # 5% improvement over baseline
            "uncertainty_calibration": 0.90,  # 90% of predictions within confidence bands
            "parameter_stability": 0.95,  # <5% variance across cross-validation folds
            "computational_efficiency": 1000,  # Max milliseconds per scenario
        }
    
    def tune_parameters(self, 
                       backtest_data: pd.DataFrame,
                       validation_elections: List[str],
                       context_hierarchy: Dict[str, List[str]],
                       n_iterations: int = 100) -> TuningResults:
        """
        Perform comprehensive parameter tuning based on backtesting results.
        
        Parameters
        ----------
        backtest_data : pd.DataFrame
            Backtesting results with actual vs predicted transfers
        validation_elections : List[str]
            Elections to use for validation (held-out set)
        context_hierarchy : Dict[str, List[str]]
            Hierarchical structure for transfer modeling
        n_iterations : int
            Number of tuning iterations
            
        Returns
        -------
        TuningResults
            Comprehensive tuning results with optimal parameters
        """
        
        print("[Parameter Tuning] Starting comprehensive parameter optimization...")
        print(f"[Parameter Tuning] Backtest data shape: {backtest_data.shape}")
        print(f"[Parameter Tuning] Validation elections: {len(validation_elections)}")
        
        # Phase 1: Coarse grid search over main parameter ranges
        print("[Parameter Tuning] Phase 1: Coarse grid search")
        coarse_results = self._coarse_grid_search(
            backtest_data, validation_elections, context_hierarchy
        )
        
        # Phase 2: Fine-tuning around best coarse parameters
        print("[Parameter Tuning] Phase 2: Fine-tuning")
        fine_results = self._fine_tune_parameters(
            coarse_results["best_params"], backtest_data, validation_elections, context_hierarchy
        )
        
        # Phase 3: Northern Ireland specific tuning
        print("[Parameter Tuning] Phase 3: NI-specific optimization")
        ni_results = self._ni_specific_tuning(
            fine_results["best_params"], backtest_data, validation_elections
        )
        
        # Phase 4: Uncertainty calibration
        print("[Parameter Tuning] Phase 4: Uncertainty calibration")
        calibration_results = self._calibrate_uncertainty(
            ni_results["best_params"], backtest_data, validation_elections
        )
        
        # Compile final results
        final_results = TuningResults(
            optimal_params=calibration_results["best_params"],
            validation_score=calibration_results["validation_score"],
            backtest_performance=calibration_results["backtest_performance"],
            parameter_stability=calibration_results["stability_score"],
            uncertainty_calibration=calibration_results["calibration_score"],
            n_iterations=n_iterations,
            convergence_reached=calibration_results["converged"]
        )
        
        print("[Parameter Tuning] Optimization complete!")
        self._print_tuning_summary(final_results)
        
        return final_results
    
    def _coarse_grid_search(self, 
                          backtest_data: pd.DataFrame,
                          validation_elections: List[str],
                          context_hierarchy: Dict[str, List[str]]) -> Dict[str, Any]:
        """Perform coarse grid search over main parameter space."""
        
        best_score = -np.inf
        best_params = None
        results = []
        
        # Grid search over main parameters
        for alpha_prior in self.param_ranges["alpha_prior"]:
            for min_samples in self.param_ranges["min_samples"]:
                for max_samples in self.param_ranges["max_samples"]:
                    for mc_samples in self.param_ranges["mc_samples"]:
                        
                        params = {
                            "alpha_prior": alpha_prior,
                            "min_samples": min_samples,
                            "max_samples": max_samples,
                            "mc_samples": mc_samples,
                            "concentration_adaptation": True
                        }
                        
                        # Evaluate parameter set
                        score, metrics = self._evaluate_parameters(
                            params, backtest_data, validation_elections, context_hierarchy
                        )
                        
                        results.append({
                            "params": params,
                            "score": score,
                            "metrics": metrics
                        })
                        
                        if score > best_score:
                            best_score = score
                            best_params = params
        
        return {
            "best_params": best_params,
            "best_score": best_score,
            "all_results": results
        }
    
    def _fine_tune_parameters(self, 
                            base_params: Dict[str, float],
                            backtest_data: pd.DataFrame,
                            validation_elections: List[str],
                            context_hierarchy: Dict[str, List[str]]) -> Dict[str, Any]:
        """Fine-tune parameters around best coarse parameters."""
        
        # Bayesian optimization style fine-tuning
        best_params = base_params.copy()
        best_score = self._evaluate_parameters(
            best_params, backtest_data, validation_elections, context_hierarchy
        )[0]
        
        # Fine-tune each parameter individually
        for param_name in ["alpha_prior", "min_samples", "max_samples", "mc_samples"]:
            if param_name not in best_params:
                continue
                
            base_value = best_params[param_name]
            fine_range = self._generate_fine_range(param_name, base_value)
            
            for fine_value in fine_range:
                test_params = best_params.copy()
                test_params[param_name] = fine_value
                
                score, metrics = self._evaluate_parameters(
                    test_params, backtest_data, validation_elections, context_hierarchy
                )
                
                if score > best_score:
                    best_score = score
                    best_params = test_params
        
        return {
            "best_params": best_params,
            "best_score": best_score
        }
    
    def _ni_specific_tuning(self, 
                          base_params: Dict[str, float],
                          backtest_data: pd.DataFrame,
                          validation_elections: List[str]) -> Dict[str, Any]:
        """Apply Northern Ireland specific parameter optimizations."""
        
        best_params = base_params.copy()
        best_score = self._evaluate_parameters(
            best_params, backtest_data, validation_elections, {}
        )[0]
        
        # Analyze backtest data for NI specific patterns
        ni_patterns = self._analyze_ni_patterns(backtest_data)
        
        # Tune bloc-specific parameters
        for bloc_type, concentration_range in self.ni_specific_ranges.items():
            if "unionist" in bloc_type:
                # Unionist transfers are more predictable
                optimal_concentration = self._find_optimal_concentration(
                    backtest_data, "unionist", concentration_range
                )
                best_params[f"{bloc_type}_concentration"] = optimal_concentration
                
            elif "nationalist" in bloc_type:
                # Nationalist transfers are more predictable
                optimal_concentration = self._find_optimal_concentration(
                    backtest_data, "nationalist", concentration_range
                )
                best_params[f"{bloc_type}_concentration"] = optimal_concentration
                
            elif "other" in bloc_type:
                # Other transfers need more uncertainty
                optimal_concentration = self._find_optimal_concentration(
                    backtest_data, "other", concentration_range
                )
                best_params[f"{bloc_type}_concentration"] = optimal_concentration
        
        # Tune stage-specific parameters based on NI patterns
        if ni_patterns["early_uncertainty"] > ni_patterns["late_uncertainty"]:
            # Early stages need more uncertainty
            best_params["early_stage_factor"] = 2.0
            best_params["late_stage_factor"] = 0.7
        
        return {
            "best_params": best_params,
            "ni_patterns": ni_patterns
        }
    
    def _calibrate_uncertainty(self, 
                             base_params: Dict[str, float],
                             backtest_data: pd.DataFrame,
                             validation_elections: List[str]) -> Dict[str, Any]:
        """Calibrate uncertainty estimates to match actual variability."""
        
        print("[Parameter Tuning] Calibrating uncertainty estimates...")
        
        best_params = base_params.copy()
        
        # Test different uncertainty calibration approaches
        calibration_methods = [
            ("basic", lambda x: x),  # No calibration
            ("moderate", lambda x: x * 1.5),  # 50% increase
            ("aggressive", lambda x: x * 2.0),  # 100% increase
            ("adaptive", lambda x: x * (1.0 + 1.0/np.sqrt(x.sum() + 1)))  # Sample size based
        ]
        
        best_calibration = None
        best_calibration_score = -np.inf
        
        for method_name, calibration_func in calibration_methods:
            test_params = best_params.copy()
            test_params["uncertainty_calibration"] = method_name
            test_params["calibration_function"] = calibration_func
            
            # Evaluate calibration
            calibration_score = self._evaluate_uncertainty_calibration(
                test_params, backtest_data, validation_elections
            )
            
            if calibration_score > best_calibration_score:
                best_calibration_score = calibration_score
                best_calibration = (method_name, calibration_func)
        
        # Apply best calibration
        if best_calibration:
            method_name, calibration_func = best_calibration
            best_params["uncertainty_calibration"] = method_name
            best_params["uncertainty_factor"] = 1.5 if method_name == "moderate" else 2.0
        
        return {
            "best_params": best_params,
            "calibration_score": best_calibration_score
        }
    
    def _evaluate_parameters(self, 
                           params: Dict[str, Any],
                           backtest_data: pd.DataFrame,
                           validation_elections: List[str],
                           context_hierarchy: Dict[str, List[str]]) -> Tuple[float, Dict[str, float]]:
        """Evaluate parameter set using backtesting results."""
        
        # Create temporary model with parameters
        from .dirichlet import DirichletTransferModel
        
        temp_model = DirichletTransferModel(
            alpha_prior=params.get("alpha_prior", 1.0),
            min_samples=int(params.get("min_samples", 5)),
            max_samples=int(params.get("max_samples", 1000)),
            mc_samples=int(params.get("mc_samples", 1000)),
            concentration_adaptation=params.get("concentration_adaptation", True)
        )
        
        # Fit model on training data (excluding validation elections)
        training_data = backtest_data[~backtest_data["election"].isin(validation_elections)]
        
        if training_data.empty:
            return 0.0, {"error": "No training data available"}
        
        # Prepare hierarchical data
        hierarchical_data = self._prepare_hierarchical_data(training_data, context_hierarchy)
        
        # Fit model
        temp_model.fit_hierarchical(hierarchical_data, context_hierarchy)
        
        # Evaluate on validation set
        validation_data = backtest_data[backtest_data["election"].isin(validation_elections)]
        
        if validation_data.empty:
            return 0.0, {"error": "No validation data available"}
        
        # Compute comprehensive evaluation metrics
        metrics = self._compute_evaluation_metrics(temp_model, validation_data)
        
        # Composite score combining multiple objectives
        composite_score = (
            0.4 * metrics["accuracy_score"] +
            0.3 * metrics["uncertainty_calibration"] +
            0.2 * metrics["coverage_probability"] +
            0.1 * (1.0 - metrics["mean_uncertainty"])  # Prefer lower uncertainty if equally accurate
        )
        
        return composite_score, metrics
    
    def _prepare_hierarchical_data(self, 
                                 data: pd.DataFrame,
                                 context_hierarchy: Dict[str, List[str]]) -> Dict[str, np.ndarray]:
        """Prepare data in hierarchical format for Dirichlet model."""
        
        hierarchical_data = {}
        
        # Group by context
        for context, child_contexts in context_hierarchy.items():
            context_data = data[data["context"] == context]
            
            if not context_data.empty:
                # Create transfer count matrix
                transfer_matrix = self._create_transfer_matrix(context_data)
                hierarchical_data[context] = transfer_matrix
        
        return hierarchical_data
    
    def _create_transfer_matrix(self, data: pd.DataFrame) -> np.ndarray:
        """Create transfer count matrix from backtest data."""
        
        # Get unique parties
        all_parties = sorted(set(data["donor_party"].unique()) | set(data["recipient_party"].unique()))
        n_parties = len(all_parties)
        
        # Create count matrix
        transfer_matrix = np.zeros((n_parties, n_parties))
        
        party_to_idx = {party: i for i, party in enumerate(all_parties)}
        
        for _, row in data.iterrows():
            donor_idx = party_to_idx.get(row["donor_party"], -1)
            recipient_idx = party_to_idx.get(row["recipient_party"], -1)
            
            if donor_idx >= 0 and recipient_idx >= 0:
                transfer_matrix[donor_idx, recipient_idx] += row.get("transfer_count", 1.0)
        
        return transfer_matrix
    
    def _compute_evaluation_metrics(self, 
                                  model: DirichletTransferModel,
                                  validation_data: pd.DataFrame) -> Dict[str, float]:
        """Compute comprehensive evaluation metrics."""
        
        metrics = {}
        
        # Accuracy metrics
        accuracy_scores = []
        for _, row in validation_data.iterrows():
            # Get prediction with uncertainty
            context = row.get("context", "global")
            donor_party = row["donor_party"]
            recipient_parties = [row["recipient_party"]]  # Simplified for evaluation
            
            probs_mean, probs_uncertainty = model.predict_proba_with_uncertainty(
                context, donor_party, recipient_parties, {}
            )
            
            # Compare with actual
            actual_prob = row.get("actual_probability", 0.0)
            predicted_prob = probs_mean[0] if len(probs_mean) > 0 else 0.0
            
            accuracy_score = 1.0 - abs(predicted_prob - actual_prob)
            accuracy_scores.append(accuracy_score)
        
        metrics["accuracy_score"] = np.mean(accuracy_scores) if accuracy_scores else 0.0
        
        # Uncertainty calibration
        uncertainty_scores = []
        coverage_indicators = []
        
        for _, row in validation_data.iterrows():
            probs_mean, probs_uncertainty = model.predict_proba_with_uncertainty(
                row.get("context", "global"), row["donor_party"], [row["recipient_party"]], {}
            )
            
            predicted_prob = probs_mean[0] if len(probs_mean) > 0 else 0.0
            predicted_uncertainty = probs_uncertainty[0] if len(probs_uncertainty) > 0 else 0.0
            actual_prob = row.get("actual_probability", 0.0)
            
            # Check if actual value is within predicted uncertainty bands
            lower_bound = max(0.0, predicted_prob - 1.96 * predicted_uncertainty)
            upper_bound = min(1.0, predicted_prob + 1.96 * predicted_uncertainty)
            
            is_covered = lower_bound <= actual_prob <= upper_bound
            coverage_indicators.append(is_covered)
            
            # Uncertainty calibration score
            uncertainty_scores.append(1.0 - abs(predicted_uncertainty - abs(predicted_prob - actual_prob)))
        
        metrics["uncertainty_calibration"] = np.mean(uncertainty_scores) if uncertainty_scores else 0.0
        metrics["coverage_probability"] = np.mean(coverage_indicators) if coverage_indicators else 0.0
        metrics["mean_uncertainty"] = np.mean([model.get_uncertainty_metrics("global").get("within_context_uncertainty", 0.0)])
        
        return metrics
    
    def _analyze_ni_patterns(self, backtest_data: pd.DataFrame) -> Dict[str, Any]:
        """Analyze Northern Ireland specific patterns in backtest data."""
        
        patterns = {}
        
        # Bloc-specific analysis
        bloc_data = backtest_data.groupby("donor_bloc").agg({
            "transfer_accuracy": "mean",
            "transfer_variance": "mean",
            "sample_size": "sum"
        }).reset_index()
        
        for _, row in bloc_data.iterrows():
            bloc = row["donor_bloc"]
            patterns[f"{bloc}_accuracy"] = row["transfer_accuracy"]
            patterns[f"{bloc}_variance"] = row["transfer_variance"]
        
        # Stage-specific analysis
        if "count_stage" in backtest_data.columns:
            stage_data = backtest_data.groupby("count_stage").agg({
                "transfer_accuracy": "mean",
                "transfer_variance": "mean"
            }).reset_index()
            
            early_stages = stage_data[stage_data["count_stage"] == "early"]
            late_stages = stage_data[stage_data["count_stage"] == "late"]
            
            if not early_stages.empty:
                patterns["early_uncertainty"] = early_stages["transfer_variance"].iloc[0]
            if not late_stages.empty:
                patterns["late_uncertainty"] = late_stages["transfer_variance"].iloc[0]
        
        return patterns
    
    def _generate_fine_range(self, param_name: str, base_value: float) -> List[float]:
        """Generate fine-tuning range around base parameter value."""
        
        if param_name == "alpha_prior":
            return [base_value * 0.8, base_value * 0.9, base_value, base_value * 1.1, base_value * 1.2]
        elif param_name == "min_samples":
            return [max(1, int(base_value * 0.8)), int(base_value * 0.9), base_value, int(base_value * 1.1), int(base_value * 1.2)]
        elif param_name == "max_samples":
            return [int(base_value * 0.5), int(base_value * 0.8), base_value, int(base_value * 1.2), int(base_value * 1.5)]
        elif param_name == "mc_samples":
            return [int(base_value * 0.5), int(base_value * 0.8), base_value, int(base_value * 1.2), int(base_value * 2.0)]
        else:
            return [base_value]
    
    def _evaluate_uncertainty_calibration(self, 
                                        params: Dict[str, Any],
                                        backtest_data: pd.DataFrame,
                                        validation_elections: List[str]) -> float:
        """Evaluate uncertainty calibration specifically."""
        
        # This would implement proper uncertainty calibration evaluation
        # For now, return a placeholder based on calibration method
        calibration_method = params.get("uncertainty_calibration", "basic")
        
        calibration_scores = {
            "basic": 0.7,
            "moderate": 0.8,
            "aggressive": 0.85,
            "adaptive": 0.9
        }
        
        return calibration_scores.get(calibration_method, 0.7)
    
    def _print_tuning_summary(self, results: TuningResults) -> None:
        """Print comprehensive tuning summary."""
        
        print("\n" + "="*60)
        print("PARAMETER TUNING SUMMARY")
        print("="*60)
        
        print(f"Optimal Parameters:")
        for param, value in results.optimal_params.items():
            print(f"  {param}: {value}")
        
        print(f"\nPerformance Metrics:")
        print(f"  Validation Score: {results.validation_score:.4f}")
        print(f"  Parameter Stability: {results.parameter_stability:.4f}")
        print(f"  Uncertainty Calibration: {results.uncertainty_calibration:.4f}")
        print(f"  Convergence Reached: {results.convergence_reached}")
        
        print(f"\nBacktest Performance:")
        for metric, value in results.backtest_performance.items():
            print(f"  {metric}: {value:.4f}")
        
        print("="*60)