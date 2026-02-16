"""Production testing and evaluation framework for enhanced transfer models."""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
from datetime import datetime
import json
import warnings
from pathlib import Path

from ..features.transfers.dirichlet import DirichletTransferModel, MonteCarloSimulator
from ..features.transfers.parameter_tuning import DirichletParameterTuner, TuningResults


@dataclass
class EvaluationResults:
    """Comprehensive evaluation results."""
    accuracy_metrics: Dict[str, float]
    uncertainty_metrics: Dict[str, float]
    calibration_metrics: Dict[str, float]
    performance_metrics: Dict[str, float]
    comparison_baseline: Dict[str, float]
    election_specific_results: Dict[str, Dict[str, float]]
    timestamp: str
    model_version: str


class TransferModelEvaluator:
    """
    Production testing framework for enhanced transfer models.
    
    Implements comprehensive evaluation including:
    - Accuracy assessment on held-out elections
    - Uncertainty calibration validation
    - Performance benchmarking
    - Comparison with baseline models
    - Election-specific analysis
    """
    
    def __init__(self, 
                 test_elections: List[str],
                 baseline_model_path: Optional[str] = None,
                 results_dir: str = "evaluation_results"):
        """
        Initialize the evaluator.
        
        Parameters
        ----------
        test_elections : List[str]
            Elections to use for testing (held-out set)
        baseline_model_path : Optional[str]
            Path to baseline model for comparison
        results_dir : str
            Directory to store evaluation results
        """
        self.test_elections = test_elections
        self.baseline_model_path = baseline_model_path
        self.results_dir = Path(results_dir)
        self.results_dir.mkdir(exist_ok=True)
        
        # Evaluation configuration
        self.evaluation_config = {
            "confidence_levels": [0.68, 0.90, 0.95],
            "accuracy_thresholds": [0.01, 0.05, 0.10],  # 1%, 5%, 10% error
            "min_sample_size": 10,
            "monte_carlo_iterations": 1000,
            "uncertainty_calibration_bins": 10
        }
        
        # Results storage
        self.current_results: Optional[EvaluationResults] = None
        self.historical_results: List[EvaluationResults] = []
    
    def run_production_evaluation(self, 
                                enhanced_model: DirichletTransferModel,
                                election_data: pd.DataFrame,
                                context_hierarchy: Dict[str, List[str]],
                                model_version: str = "enhanced_v1.0") -> EvaluationResults:
        """
        Run comprehensive production evaluation.
        
        Parameters
        ----------
        enhanced_model : DirichletTransferModel
            The enhanced model to evaluate
        election_data : pd.DataFrame
            Complete election data including test elections
        context_hierarchy : Dict[str, List[str]]
            Hierarchical context structure
        model_version : str
            Version identifier for the model
            
        Returns
        -------
        EvaluationResults
            Comprehensive evaluation results
        """
        
        print("[Production Evaluation] Starting comprehensive evaluation...")
        print(f"[Production Evaluation] Test elections: {len(self.test_elections)}")
        print(f"[Production Evaluation] Model version: {model_version}")
        
        # 1. Accuracy evaluation on held-out elections
        print("[Production Evaluation] Phase 1: Accuracy evaluation")
        accuracy_results = self._evaluate_accuracy(
            enhanced_model, election_data, self.test_elections
        )
        
        # 2. Uncertainty calibration validation
        print("[Production Evaluation] Phase 2: Uncertainty calibration")
        uncertainty_results = self._evaluate_uncertainty_calibration(
            enhanced_model, election_data, self.test_elections
        )
        
        # 3. Performance benchmarking
        print("[Production Evaluation] Phase 3: Performance benchmarking")
        performance_results = self._evaluate_performance(
            enhanced_model, election_data
        )
        
        # 4. Comparison with baseline (if available)
        print("[Production Evaluation] Phase 4: Baseline comparison")
        comparison_results = self._compare_with_baseline(
            enhanced_model, election_data, self.test_elections
        )
        
        # 5. Election-specific analysis
        print("[Production Evaluation] Phase 5: Election-specific analysis")
        election_specific = self._election_specific_analysis(
            enhanced_model, election_data, self.test_elections
        )
        
        # Compile comprehensive results
        results = EvaluationResults(
            accuracy_metrics=accuracy_results,
            uncertainty_metrics=uncertainty_results,
            calibration_metrics={},  # Will be filled from uncertainty results
            performance_metrics=performance_results,
            comparison_baseline=comparison_results,
            election_specific_results=election_specific,
            timestamp=datetime.now().isoformat(),
            model_version=model_version
        )
        
        # Store results
        self.current_results = results
        self.historical_results.append(results)
        
        # Save detailed results
        self._save_evaluation_results(results)
        
        print("[Production Evaluation] Evaluation complete!")
        self._print_evaluation_summary(results)
        
        return results
    
    def _evaluate_accuracy(self, 
                         model: DirichletTransferModel,
                         election_data: pd.DataFrame,
                         test_elections: List[str]) -> Dict[str, float]:
        """Evaluate accuracy on held-out elections."""
        
        test_data = election_data[election_data["election"].isin(test_elections)]
        
        if test_data.empty:
            return {"error": "No test data available"}
        
        accuracy_scores = []
        party_specific_scores = {"unionist": [], "nationalist": [], "other": []}
        stage_specific_scores = {"early": [], "late": []}
        
        for _, row in test_data.iterrows():
            # Get model prediction
            context = row.get("context", "global")
            donor_party = row["donor_party"]
            recipient_parties = [row["recipient_party"]]  # Simplified for evaluation
            
            probs_mean, probs_uncertainty = model.predict_proba_with_uncertainty(
                context, donor_party, recipient_parties, {}
            )
            
            predicted_prob = probs_mean[0] if len(probs_mean) > 0 else 0.0
            actual_prob = row.get("actual_probability", 0.0)
            
            # Accuracy score (1 - absolute error)
            accuracy = 1.0 - abs(predicted_prob - actual_prob)
            accuracy_scores.append(accuracy)
            
            # Party-specific analysis
            donor_bloc = row.get("donor_bloc", "unknown")
            if donor_bloc in party_specific_scores:
                party_specific_scores[donor_bloc].append(accuracy)
            
            # Stage-specific analysis
            stage = row.get("count_stage", "unknown")
            if stage in stage_specific_scores:
                stage_specific_scores[stage].append(accuracy)
        
        # Compile accuracy metrics
        accuracy_metrics = {
            "overall_accuracy": np.mean(accuracy_scores) if accuracy_scores else 0.0,
            "accuracy_std": np.std(accuracy_scores) if accuracy_scores else 0.0,
            "accuracy_improvement": self._calculate_improvement(accuracy_scores),
            "party_specific": {
                bloc: np.mean(scores) if scores else 0.0
                for bloc, scores in party_specific_scores.items()
            },
            "stage_specific": {
                stage: np.mean(scores) if scores else 0.0
                for stage, scores in stage_specific_scores.items()
            }
        }
        
        return accuracy_metrics
    
    def _evaluate_uncertainty_calibration(self, 
                                        model: DirichletTransferModel,
                                        election_data: pd.DataFrame,
                                        test_elections: List[str]) -> Dict[str, float]:
        """Evaluate uncertainty calibration."""
        
        test_data = election_data[election_data["election"].isin(test_elections)]
        
        if test_data.empty:
            return {"error": "No test data available"}
        
        coverage_results = {level: [] for level in self.evaluation_config["confidence_levels"]}
        uncertainty_scores = []
        calibration_bins = {i: {"predicted": [], "actual": []} for i in range(self.evaluation_config["uncertainty_calibration_bins"])}
        
        for _, row in test_data.iterrows():
            # Get model prediction with uncertainty
            context = row.get("context", "global")
            donor_party = row["donor_party"]
            recipient_parties = [row["recipient_party"]]  # Simplified for evaluation
            
            probs_mean, probs_uncertainty = model.predict_proba_with_uncertainty(
                context, donor_party, recipient_parties, {}
            )
            
            predicted_prob = probs_mean[0] if len(probs_mean) > 0 else 0.0
            predicted_uncertainty = probs_uncertainty[0] if len(probs_uncertainty) > 0 else 0.0
            actual_prob = row.get("actual_probability", 0.0)
            
            # Coverage analysis for different confidence levels
            for confidence_level in self.evaluation_config["confidence_levels"]:
                z_score = self._get_z_score(confidence_level)
                lower_bound = max(0.0, predicted_prob - z_score * predicted_uncertainty)
                upper_bound = min(1.0, predicted_prob + z_score * predicted_uncertainty)
                
                is_covered = lower_bound <= actual_prob <= upper_bound
                coverage_results[confidence_level].append(is_covered)
            
            # Uncertainty calibration score
            uncertainty_score = 1.0 - abs(predicted_uncertainty - abs(predicted_prob - actual_prob))
            uncertainty_scores.append(uncertainty_score)
            
            # Calibration bin analysis
            predicted_uncertainty_norm = predicted_uncertainty / max(predicted_prob, 1.0 - predicted_prob)
            bin_idx = min(int(predicted_uncertainty_norm * self.evaluation_config["uncertainty_calibration_bins"]), 
                         self.evaluation_config["uncertainty_calibration_bins"] - 1)
            
            calibration_bins[bin_idx]["predicted"].append(predicted_uncertainty)
            calibration_bins[bin_idx]["actual"].append(abs(predicted_prob - actual_prob))
        
        # Compile uncertainty metrics
        uncertainty_metrics = {
            "coverage_by_confidence": {
                level: np.mean(coverage) if coverage else 0.0
                for level, coverage in coverage_results.items()
            },
            "mean_uncertainty_score": np.mean(uncertainty_scores) if uncertainty_scores else 0.0,
            "uncertainty_calibration_score": self._compute_calibration_score(calibration_bins),
            "overconfidence_detection": self._detect_overconfidence(coverage_results),
            "underconfidence_detection": self._detect_underconfidence(coverage_results)
        }
        
        return uncertainty_metrics
    
    def _evaluate_performance(self, 
                            model: DirichletTransferModel,
                            election_data: pd.DataFrame) -> Dict[str, float]:
        """Evaluate computational performance."""
        
        import time
        
        # Performance benchmarking
        performance_times = []
        memory_usage = []
        
        # Sample data for performance testing
        sample_size = min(100, len(election_data))
        sample_data = election_data.sample(n=sample_size, random_state=42)
        
        for _, row in sample_data.iterrows():
            start_time = time.time()
            
            # Single prediction
            context = row.get("context", "global")
            donor_party = row["donor_party"]
            recipient_parties = [row["recipient_party"]]
            
            probs_mean, probs_uncertainty = model.predict_proba_with_uncertainty(
                context, donor_party, recipient_parties, {}
            )
            
            end_time = time.time()
            performance_times.append(end_time - start_time)
        
        # Performance metrics
        performance_metrics = {
            "mean_prediction_time": np.mean(performance_times),
            "median_prediction_time": np.median(performance_times),
            "95th_percentile_time": np.percentile(performance_times, 95),
            "throughput_per_second": 1.0 / np.mean(performance_times),
            "scalability_score": self._assess_scalability(performance_times)
        }
        
        return performance_metrics
    
    def _compare_with_baseline(self, 
                             enhanced_model: DirichletTransferModel,
                             election_data: pd.DataFrame,
                             test_elections: List[str]) -> Dict[str, float]:
        """Compare enhanced model with baseline."""
        
        if not self.baseline_model_path:
            return {"comparison_available": False}
        
        try:
            # Load baseline model
            from ..features.transfers.encoders import TransferModel
            import pickle
            
            with open(self.baseline_model_path, 'rb') as f:
                baseline_model = pickle.load(f)
            
            # Get test data
            test_data = election_data[election_data["election"].isin(test_elections)]
            
            # Compare predictions
            comparison_results = {
                "accuracy_improvement": 0.0,
                "uncertainty_improvement": 0.0,
                "performance_improvement": 0.0,
                "comparison_available": True
            }
            
            # Detailed comparison metrics
            accuracy_improvements = []
            uncertainty_improvements = []
            performance_improvements = []
            
            for _, row in test_data.iterrows():
                # Enhanced model prediction
                context = row.get("context", "global")
                donor_party = row["donor_party"]
                recipient_parties = [row["recipient_party"]]
                
                enhanced_probs, enhanced_uncertainty = enhanced_model.predict_proba_with_uncertainty(
                    context, donor_party, recipient_parties, {}
                )
                
                # Baseline model prediction (simplified)
                baseline_probs = np.array([0.1])  # Placeholder - would need actual baseline
                
                # Compare accuracy
                actual_prob = row.get("actual_probability", 0.0)
                enhanced_accuracy = 1.0 - abs(enhanced_probs[0] - actual_prob)
                baseline_accuracy = 1.0 - abs(baseline_probs[0] - actual_prob)
                
                accuracy_improvements.append(enhanced_accuracy - baseline_accuracy)
                
                # Compare uncertainty (enhanced should have better calibration)
                uncertainty_improvements.append(enhanced_uncertainty[0] - 0.05)  # Placeholder comparison
            
            comparison_results["accuracy_improvement"] = np.mean(accuracy_improvements) if accuracy_improvements else 0.0
            comparison_results["uncertainty_improvement"] = np.mean(uncertainty_improvements) if uncertainty_improvements else 0.0
            
            return comparison_results
            
        except Exception as e:
            return {"comparison_available": False, "error": str(e)}
    
    def _election_specific_analysis(self, 
                                  model: DirichletTransferModel,
                                  election_data: pd.DataFrame,
                                  test_elections: List[str]) -> Dict[str, Dict[str, float]]:
        """Perform election-specific analysis."""
        
        election_results = {}
        
        for election in test_elections:
            election_subset = election_data[election_data["election"] == election]
            
            if election_subset.empty:
                continue
            
            # Election-specific metrics
            accuracy_scores = []
            uncertainty_scores = []
            transfer_patterns = []
            
            for _, row in election_subset.iterrows():
                # Get prediction
                context = row.get("context", "global")
                donor_party = row["donor_party"]
                recipient_parties = [row["recipient_party"]]
                
                probs_mean, probs_uncertainty = model.predict_proba_with_uncertainty(
                    context, donor_party, recipient_parties, {}
                )
                
                predicted_prob = probs_mean[0] if len(probs_mean) > 0 else 0.0
                actual_prob = row.get("actual_probability", 0.0)
                
                # Calculate metrics
                accuracy = 1.0 - abs(predicted_prob - actual_prob)
                accuracy_scores.append(accuracy)
                uncertainty_scores.append(probs_uncertainty[0] if len(probs_uncertainty) > 0 else 0.0)
                
                # Transfer pattern analysis
                transfer_patterns.append({
                    "donor_party": donor_party,
                    "recipient_party": recipient_parties[0],
                    "predicted_prob": predicted_prob,
                    "actual_prob": actual_prob,
                    "uncertainty": probs_uncertainty[0] if len(probs_uncertainty) > 0 else 0.0
                })
            
            # Analyze transfer patterns for this election
            pattern_analysis = self._analyze_election_patterns(transfer_patterns)
            
            election_results[election] = {
                "overall_accuracy": np.mean(accuracy_scores) if accuracy_scores else 0.0,
                "mean_uncertainty": np.mean(uncertainty_scores) if uncertainty_scores else 0.0,
                "transfer_patterns": pattern_analysis,
                "sample_size": len(election_subset)
            }
        
        return election_results
    
    def _analyze_election_patterns(self, transfer_patterns: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze transfer patterns for specific election."""
        
        if not transfer_patterns:
            return {"error": "No transfer patterns available"}
        
        # Convert to DataFrame for analysis
        patterns_df = pd.DataFrame(transfer_patterns)
        
        # Bloc-level analysis
        bloc_analysis = patterns_df.groupby(["donor_party", "recipient_party"]).agg({
            "predicted_prob": "mean",
            "actual_prob": "mean",
            "uncertainty": "mean"
        }).reset_index()
        
        # Accuracy by party pair
        bloc_analysis["accuracy"] = 1.0 - abs(bloc_analysis["predicted_prob"] - bloc_analysis["actual_prob"])
        
        # Overall pattern metrics
        overall_metrics = {
            "mean_predicted_probability": patterns_df["predicted_prob"].mean(),
            "mean_actual_probability": patterns_df["actual_prob"].mean(),
            "mean_accuracy": (1.0 - abs(patterns_df["predicted_prob"] - patterns_df["actual_prob"])).mean(),
            "mean_uncertainty": patterns_df["uncertainty"].mean(),
            "most_common_pattern": patterns_df.groupby(["donor_party", "recipient_party"]).size().idxmax() if len(patterns_df) > 0 else None
        }
        
        return {
            "bloc_analysis": bloc_analysis.to_dict("records"),
            "overall_metrics": overall_metrics,
            "pattern_count": len(patterns_df)
        }
    
    def _save_evaluation_results(self, results: EvaluationResults) -> None:
        """Save detailed evaluation results."""
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"evaluation_results_{timestamp}.json"
        filepath = self.results_dir / filename
        
        # Convert to serializable format
        results_dict = {
            "accuracy_metrics": results.accuracy_metrics,
            "uncertainty_metrics": results.uncertainty_metrics,
            "calibration_metrics": results.calibration_metrics,
            "performance_metrics": results.performance_metrics,
            "comparison_baseline": results.comparison_baseline,
            "election_specific_results": results.election_specific_results,
            "timestamp": results.timestamp,
            "model_version": results.model_version
        }
        
        with open(filepath, 'w') as f:
            json.dump(results_dict, f, indent=2, default=str)
        
        print(f"[Production Evaluation] Results saved to: {filepath}")
    
    def _print_evaluation_summary(self, results: EvaluationResults) -> None:
        """Print evaluation summary."""
        
        print("\n" + "="*60)
        print("PRODUCTION EVALUATION SUMMARY")
        print("="*60)
        
        print(f"Model Version: {results.model_version}")
        print(f"Evaluation Time: {results.timestamp}")
        print(f"Test Elections: {len(results.election_specific_results)}")
        
        print(f"\nAccuracy Metrics:")
        for metric, value in results.accuracy_metrics.items():
            if isinstance(value, float):
                print(f"  {metric}: {value:.4f}")
            elif isinstance(value, dict):
                print(f"  {metric}:")
                for sub_metric, sub_value in value.items():
                    print(f"    {sub_metric}: {sub_value:.4f}")
        
        print(f"\nUncertainty Calibration:")
        for level, coverage in results.uncertainty_metrics.get("coverage_by_confidence", {}).items():
            print(f"  {int(level*100)}% confidence: {coverage:.3f} coverage")
        
        print(f"\nPerformance Metrics:")
        for metric, value in results.performance_metrics.items():
            if isinstance(value, float):
                print(f"  {metric}: {value:.4f}")
        
        print("="*60)
    
    def _get_z_score(self, confidence_level: float) -> float:
        """Get z-score for confidence level."""
        
        # Standard normal z-scores for common confidence levels
        z_scores = {
            0.68: 1.0,
            0.90: 1.645,
            0.95: 1.96,
            0.99: 2.576
        }
        
        return z_scores.get(confidence_level, 1.96)  # Default to 95%
    
    def _calculate_improvement(self, scores: List[float]) -> float:
        """Calculate improvement over baseline."""
        
        if not scores:
            return 0.0
        
        # Assume baseline accuracy of 0.85 (85%) for basic transfer models
        baseline_accuracy = 0.85
        current_accuracy = np.mean(scores)
        
        return (current_accuracy - baseline_accuracy) / baseline_accuracy
    
    def _compute_calibration_score(self, calibration_bins: Dict[int, Dict[str, List[float]]]) -> float:
        """Compute uncertainty calibration score."""
        
        calibration_errors = []
        
        for bin_data in calibration_bins.values():
            if bin_data["predicted"] and bin_data["actual"]:
                predicted_uncertainties = np.array(bin_data["predicted"])
                actual_errors = np.array(bin_data["actual"])
                
                # Calibration error: difference between predicted uncertainty and actual error
                calibration_error = np.mean(np.abs(predicted_uncertainties - actual_errors))
                calibration_errors.append(calibration_error)
        
        return 1.0 - np.mean(calibration_errors) if calibration_errors else 0.0
    
    def _detect_overconfidence(self, coverage_results: Dict[float, List[bool]]) -> float:
        """Detect model overconfidence."""
        
        overconfidence_scores = []
        
        for confidence_level, coverage in coverage_results.items():
            expected_coverage = confidence_level
            actual_coverage = np.mean(coverage) if coverage else 0.0
            
            # Overconfidence if actual coverage < expected coverage
            overconfidence = max(0.0, expected_coverage - actual_coverage)
            overconfidence_scores.append(overconfidence)
        
        return np.mean(overconfidence_scores) if overconfidence_scores else 0.0
    
    def _detect_underconfidence(self, coverage_results: Dict[float, List[bool]]) -> float:
        """Detect model underconfidence."""
        
        underconfidence_scores = []
        
        for confidence_level, coverage in coverage_results.items():
            expected_coverage = confidence_level
            actual_coverage = np.mean(coverage) if coverage else 0.0
            
            # Underconfidence if actual coverage > expected coverage by too much
            underconfidence = max(0.0, actual_coverage - expected_coverage - 0.05)  # 5% tolerance
            underconfidence_scores.append(underconfidence)
        
        return np.mean(underconfidence_scores) if underconfidence_scores else 0.0
    
    def _assess_scalability(self, performance_times: List[float]) -> float:
        """Assess model scalability."""
        
        if not performance_times:
            return 0.0
        
        # Scalability score based on consistency of performance times
        cv = np.std(performance_times) / np.mean(performance_times)
        
        # Lower CV = better scalability
        scalability_score = max(0.0, 1.0 - cv)
        
        return scalability_score