"""Complete Dirichlet uncertainty propagation for hierarchical transfer modeling."""

import numpy as np
from typing import Dict, List, Tuple, Optional, Any
from scipy import stats
from scipy.special import gammaln, digamma, polygamma
import warnings


class DirichletTransferModel:
    """
    Complete Dirichlet uncertainty propagation for transfer modeling.
    
    This implements a full hierarchical Bayesian approach with:
    - Dirichlet priors for transfer probabilities
    - Monte Carlo sampling for uncertainty propagation
    - Hierarchical structure for different contexts (party, body, election type)
    - Adaptive concentration parameters based on sample size
    """
    
    def __init__(self, 
                 alpha_prior: float = 1.0,
                 min_samples: int = 5,
                 max_samples: int = 1000,
                 mc_samples: int = 1000,
                 concentration_adaptation: bool = True):
        """
        Initialize the Dirichlet transfer model.
        
        Parameters
        ----------
        alpha_prior : float
            Prior concentration parameter (higher = more concentrated around mean)
        min_samples : int
            Minimum samples before using empirical Bayes
        max_samples : int
            Maximum samples for computational efficiency
        mc_samples : int
            Number of Monte Carlo samples for uncertainty propagation
        concentration_adaptation : bool
            Whether to adapt concentration based on sample size
        """
        self.alpha_prior = alpha_prior
        self.min_samples = min_samples
        self.max_samples = max_samples
        self.mc_samples = mc_samples
        self.concentration_adaptation = concentration_adaptation
        
        # Hierarchical structure storage
        self.hierarchical_alphas: Dict[str, np.ndarray] = {}
        self.context_counts: Dict[str, int] = {}
        self.context_transfers: Dict[str, np.ndarray] = {}
        
        # Monte Carlo state
        self.mc_cache: Dict[str, np.ndarray] = {}
        self.uncertainty_cache: Dict[str, Tuple[float, float]] = {}
        
    def fit_hierarchical(self, 
                        transfer_data: Dict[str, np.ndarray],
                        context_hierarchy: Dict[str, List[str]]) -> None:
        """
        Fit hierarchical Dirichlet model across multiple contexts.
        
        Parameters
        ----------
        transfer_data : dict
            Dictionary mapping context keys to transfer count matrices
        context_hierarchy : dict
            Dictionary defining hierarchical relationships between contexts
        """
        # Fit individual contexts first
        for context, counts in transfer_data.items():
            self._fit_context_dirichlet(context, counts)
        
        # Apply hierarchical shrinkage
        self._apply_hierarchical_shrinkage(context_hierarchy)
        
        # Compute between-context uncertainty
        self._compute_hierarchical_uncertainty()
    
    def _fit_context_dirichlet(self, context: str, counts: np.ndarray) -> None:
        """Fit Dirichlet distribution for a specific context."""
        # Ensure minimum samples
        if counts.sum() < self.min_samples:
            # Use prior only
            n_categories = counts.shape[1] if len(counts.shape) > 1 else counts.shape[0]
            self.hierarchical_alphas[context] = np.full(n_categories, self.alpha_prior)
            self.context_counts[context] = 0
            return
        
        # Limit sample size for computational efficiency
        if counts.sum() > self.max_samples:
            # Subsample proportionally
            subsample_ratio = self.max_samples / counts.sum()
            counts = (counts * subsample_ratio).astype(int)
            counts = np.maximum(counts, 1)  # Ensure at least 1 per category
        
        # Compute empirical Bayes estimates
        if len(counts.shape) == 2:  # Multiple donors, multiple recipients
            # Sum across donors for overall context
            total_counts = counts.sum(axis=0)
        else:
            total_counts = counts
        
        # Empirical Bayes estimation with concentration adaptation
        n_observations = total_counts.sum()
        n_categories = len(total_counts)
        
        # Adapt concentration based on sample size (N_min, N_max tuning)
        if self.concentration_adaptation:
            effective_alpha = self._adapt_concentration(n_observations, n_categories)
        else:
            effective_alpha = self.alpha_prior
        
        # Dirichlet-Multinomial empirical Bayes
        empirical_probs = total_counts / n_observations
        self.hierarchical_alphas[context] = effective_alpha * empirical_probs * n_observations
        self.context_counts[context] = n_observations
        self.context_transfers[context] = total_counts
    
    def _adapt_concentration(self, n_observations: int, n_categories: int) -> float:
        """
        Adapt concentration parameter based on sample size.
        
        This implements the N_min, N_max parameter tuning discussed in Phase 2.
        """
        # Phase 2 tuning: adaptive concentration based on sample size
        if n_observations < 50:  # N_min threshold
            return self.alpha_prior * 2.0  # Higher concentration for small samples
        elif n_observations > 500:  # N_max threshold  
            return self.alpha_prior * 0.5  # Lower concentration for large samples
        else:
            # Linear interpolation between thresholds
            ratio = (n_observations - 50) / (500 - 50)
            return self.alpha_prior * (2.0 - 1.5 * ratio)
    
    def _apply_hierarchical_shrinkage(self, context_hierarchy: Dict[str, List[str]]) -> None:
        """Apply hierarchical shrinkage between related contexts."""
        for parent_context, child_contexts in context_hierarchy.items():
            if parent_context not in self.hierarchical_alphas:
                continue
                
            parent_alpha = self.hierarchical_alphas[parent_context]
            parent_count = self.context_counts.get(parent_context, 0)
            
            for child_context in child_contexts:
                if child_context not in self.hierarchical_alphas:
                    continue
                
                child_alpha = self.hierarchical_alphas[child_context]
                child_count = self.context_counts.get(child_context, 0)
                
                # Hierarchical shrinkage: weighted average of child and parent
                # More weight to parent when child has fewer samples
                parent_weight = max(0.1, min(0.5, 1.0 - child_count / 200.0))
                child_weight = 1.0 - parent_weight
                
                # Apply shrinkage
                self.hierarchical_alphas[child_context] = (
                    child_weight * child_alpha + 
                    parent_weight * parent_alpha
                )
    
    def predict_proba_with_uncertainty(self, 
                                     context: str, 
                                     donor_party: str,
                                     recipient_parties: List[str],
                                     donor_context: Dict[str, Any]) -> Tuple[np.ndarray, np.ndarray]:
        """
        Predict probabilities with full uncertainty propagation.
        
        Returns
        -------
        probs_mean : np.ndarray
            Mean probability estimates
        probs_uncertainty : np.ndarray
            Uncertainty estimates (standard deviation)
        """
        # Get context-specific alphas
        if context not in self.hierarchical_alphas:
            # Use fallback to global context
            context = "global"
        
        alphas = self.hierarchical_alphas.get(context)
        if alphas is None:
            # Uniform fallback
            alphas = np.ones(len(recipient_parties)) * self.alpha_prior
        
        # Monte Carlo sampling for uncertainty propagation
        cache_key = f"{context}_{donor_party}_{'_'.join(recipient_parties)}"
        
        if cache_key not in self.mc_cache:
            # Generate Monte Carlo samples
            mc_samples = self._generate_mc_samples(alphas, donor_context)
            self.mc_cache[cache_key] = mc_samples
        
        mc_samples = self.mc_cache[cache_key]
        
        # Compute mean and uncertainty
        probs_mean = mc_samples.mean(axis=0)
        probs_uncertainty = mc_samples.std(axis=0)
        
        return probs_mean, probs_uncertainty
    
    def _generate_mc_samples(self, alphas: np.ndarray, context: Dict[str, Any]) -> np.ndarray:
        """Generate Monte Carlo samples from Dirichlet distribution."""
        # Incorporate context-specific adjustments
        adjusted_alphas = self._adjust_alphas_for_context(alphas, context)
        
        # Generate MC samples
        samples = np.random.dirichlet(adjusted_alphas, size=self.mc_samples)
        
        # Apply context-specific transformations
        samples = self._apply_context_transformations(samples, context)
        
        return samples
    
    def _adjust_alphas_for_context(self, alphas: np.ndarray, context: Dict[str, Any]) -> np.ndarray:
        """Adjust alphas based on specific context features."""
        adjusted = alphas.copy()
        
        # Adjust for election stage (early vs late)
        if context.get("is_early", False):
            # Early counts: more uncertainty
            adjusted *= 0.8
        elif context.get("is_late", False):
            # Late counts: more certainty
            adjusted *= 1.2
        
        # Adjust for transfer type
        if context.get("is_surplus", False):
            # Surplus transfers: more predictable
            adjusted *= 1.1
        elif context.get("is_elimination", False):
            # Elimination transfers: more uncertainty
            adjusted *= 0.9
        
        # Adjust for party strength
        if context.get("donor_first_share", 0.0) > 0.5:
            # Strong donors: more predictable transfers
            adjusted *= 1.15
        
        return adjusted
    
    def _apply_context_transformations(self, samples: np.ndarray, context: Dict[str, Any]) -> np.ndarray:
        """Apply context-specific transformations to MC samples."""
        transformed = samples.copy()
        
        # Apply viability-based adjustments
        if "viability_scores" in context:
            viability = np.array(context["viability_scores"])
            # More viable recipients get slightly higher probabilities
            viability_factor = 1.0 + 0.1 * (viability - viability.mean())
            transformed *= viability_factor
            
            # Renormalize
            row_sums = transformed.sum(axis=1, keepdims=True)
            transformed = transformed / row_sums
        
        return transformed
    
    def _compute_hierarchical_uncertainty(self) -> None:
        """Compute between-context uncertainty measures."""
        contexts = list(self.hierarchical_alphas.keys())
        if len(contexts) < 2:
            return
        
        # Compute between-context variance
        context_probs = []
        for context in contexts:
            alphas = self.hierarchical_alphas[context]
            probs = alphas / alphas.sum()
            context_probs.append(probs)
        
        context_probs = np.array(context_probs)
        
        # Between-context uncertainty (variance across contexts)
        mean_prob = context_probs.mean(axis=0)
        between_context_var = context_probs.var(axis=0)
        
        # Store uncertainty measures
        self.uncertainty_cache["between_context"] = (mean_prob, between_context_var)
        
        # Compute context-specific uncertainty
        for i, context in enumerate(contexts):
            # Within-context uncertainty (inverse of concentration)
            alphas = self.hierarchical_alphas[context]
            concentration = alphas.sum()
            within_context_uncertainty = 1.0 / (concentration + 1.0)
            
            self.uncertainty_cache[context] = (context_probs[i], within_context_uncertainty)
    
    def get_uncertainty_metrics(self, context: str) -> Dict[str, float]:
        """Get comprehensive uncertainty metrics for a context."""
        metrics = {}
        
        if context in self.uncertainty_cache:
            mean_prob, uncertainty = self.uncertainty_cache[context]
            metrics["within_context_uncertainty"] = float(uncertainty)
            metrics["mean_probability"] = float(mean_prob.mean())
        
        if "between_context" in self.uncertainty_cache:
            mean_prob, between_var = self.uncertainty_cache["between_context"]
            metrics["between_context_variance"] = float(between_var.mean())
            metrics["hierarchical_uncertainty"] = float(np.sqrt(between_var).mean())
        
        # Sample size based uncertainty
        n_samples = self.context_counts.get(context, 0)
        if n_samples > 0:
            metrics["sample_size"] = n_samples
            metrics["sample_size_uncertainty"] = 1.0 / np.sqrt(n_samples)
        
        return metrics


class MonteCarloSimulator:
    """
    Monte Carlo simulator for propagating uncertainty through entire election counts.
    """
    
    def __init__(self, dirichlet_model: DirichletTransferModel, n_simulations: int = 1000):
        self.model = dirichlet_model
        self.n_simulations = n_simulations
        self.simulation_results: List[Dict[str, Any]] = []
    
    def simulate_election(self, 
                         first_prefs: np.ndarray,
                         names: List[str],
                         parties: List[str],
                         seats: int,
                         scenario_context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Run full Monte Carlo simulation of election with uncertainty propagation.
        
        Returns comprehensive uncertainty analysis including:
        - Probability distributions for each candidate
        - Confidence intervals for final counts
        - Probability of election for each candidate
        - Uncertainty bands for transfer flows
        """
        
        quota = self._calculate_quota(first_prefs.sum(), seats)
        
        # Store all simulation results
        all_final_counts = []
        all_elected = []
        all_transfer_flows = []
        
        print(f"[Monte Carlo] Running {self.n_simulations} simulations...")
        
        for sim in range(self.n_simulations):
            if sim % 100 == 0:
                print(f"[Monte Carlo] Simulation {sim+1}/{self.n_simulations}")
            
            # Run single simulation with uncertainty
            result = self._simulate_single_election(
                first_prefs.copy(), names, parties, seats, quota, scenario_context
            )
            
            all_final_counts.append(result["final_counts"])
            all_elected.append(result["elected"])
            all_transfer_flows.append(result["transfer_flows"])
        
        # Analyze results
        analysis = self._analyze_simulation_results(
            all_final_counts, all_elected, all_transfer_flows, names, parties, quota
        )
        
        return analysis
    
    def _simulate_single_election(self, 
                                first_prefs: np.ndarray,
                                names: List[str],
                                parties: List[str],
                                seats: int,
                                quota: float,
                                scenario_context: Dict[str, Any]) -> Dict[str, Any]:
        """Simulate single election with uncertainty propagation."""
        
        C = len(first_prefs)
        tallies = first_prefs.astype(float).copy()
        alive = np.ones(C, dtype=bool)
        elected = np.zeros(C, dtype=bool)
        
        # Track transfer flows for uncertainty analysis
        transfer_flows = []
        
        count = 0
        while elected.sum() < seats and alive.sum() > 0:
            count += 1
            
            # Elect obvious winners
            obvious_winners = np.where((alive) & (tallies >= quota))[0]
            for winner in obvious_winners:
                if not elected[winner]:
                    elected[winner] = True
                    surplus = tallies[winner] - quota
                    
                    if surplus > 0:
                        # Sample transfer proportions with uncertainty
                        context = scenario_context.copy()
                        context.update({
                            "is_surplus": True,
                            "is_elimination": False,
                            "count": count,
                            "donor_party": parties[winner] if winner < len(parties) else "Unknown"
                        })
                        
                        survivors = np.where(alive & ~elected)[0]
                        if survivors.size > 0:
                            # Get uncertain transfer proportions
                            surv_parties = [parties[i] if i < len(parties) else "Unknown" for i in survivors]
                            probs_mean, probs_uncertainty = self.model.predict_proba_with_uncertainty(
                                f"surplus_{count}", parties[winner] if winner < len(parties) else "Unknown", 
                                surv_parties, context
                            )
                            
                            # Add uncertainty noise
                            noisy_probs = probs_mean + np.random.normal(0, probs_uncertainty * 0.5)
                            noisy_probs = np.clip(noisy_probs, 0, 1)
                            noisy_probs = noisy_probs / noisy_probs.sum()  # Renormalize
                            
                            # Apply transfer - align dimensions properly
                            if len(noisy_probs) == len(survivors):
                                tallies[survivors] += surplus * noisy_probs
                            else:
                                # Handle dimension mismatch - pad or truncate to match
                                target_size = len(survivors)
                                source_size = len(noisy_probs)
                                
                                if source_size > target_size:
                                    # Truncate to match target size
                                    aligned_probs = noisy_probs[:target_size]
                                else:
                                    # Pad with zeros to match target size
                                    aligned_probs = np.zeros(target_size)
                                    aligned_probs[:source_size] = noisy_probs
                                
                                tallies[survivors] += surplus * aligned_probs
                            
                            # Record transfer flow
                            transfer_flows.append({
                                "count": count,
                                "donor": winner,
                                "donor_party": parties[winner] if winner < len(parties) else "Unknown",
                                "type": "surplus",
                                "proportions": noisy_probs.copy(),
                                "uncertainty": probs_uncertainty.copy()
                            })
                    
                    tallies[winner] = quota
            
            # Eliminate weakest if needed
            if elected.sum() < seats:
                weakest_alive = np.where(alive & ~elected)[0]
                if weakest_alive.size > 0:
                    elim_idx = weakest_alive[np.argmin(tallies[weakest_alive])]
                    
                    # Sample elimination transfer with uncertainty
                    context = scenario_context.copy()
                    context.update({
                        "is_surplus": False,
                        "is_elimination": True,
                        "count": count,
                        "donor_party": parties[elim_idx] if elim_idx < len(parties) else "Unknown"
                    })
                    
                    survivors = np.where(alive & ~elected)[0]
                    if survivors.size > 0:
                        surv_parties = [parties[i] if i < len(parties) else "Unknown" for i in survivors]
                        probs_mean, probs_uncertainty = self.model.predict_proba_with_uncertainty(
                            f"elimination_{count}", parties[elim_idx] if elim_idx < len(parties) else "Unknown",
                            surv_parties, context
                        )
                        
                        # Add uncertainty noise
                        noisy_probs = probs_mean + np.random.normal(0, probs_uncertainty * 0.5)
                        noisy_probs = np.clip(noisy_probs, 0, 1)
                        noisy_probs = noisy_probs / noisy_probs.sum()  # Renormalize
                        
                        # Apply transfer - ensure proper dimension alignment
                        votes_to_transfer = tallies[elim_idx]
                        
                        # Ensure noisy_probs matches survivors dimension
                        if len(noisy_probs) == len(survivors):
                            # Perfect match - apply directly
                            tallies[survivors] += votes_to_transfer * noisy_probs
                        else:
                            # Dimension mismatch - create aligned array
                            aligned_probs = np.zeros(len(survivors))
                            
                            # Map probabilities to survivor positions (assuming 1:1 mapping for now)
                            min_len = min(len(noisy_probs), len(survivors))
                            aligned_probs[:min_len] = noisy_probs[:min_len]
                            
                            # Renormalize
                            if aligned_probs.sum() > 0:
                                aligned_probs = aligned_probs / aligned_probs.sum()
                            
                            tallies[survivors] += votes_to_transfer * aligned_probs
                        
                        # Record transfer flow
                        transfer_flows.append({
                            "count": count,
                            "donor": elim_idx,
                            "donor_party": parties[elim_idx] if elim_idx < len(parties) else "Unknown",
                            "type": "elimination",
                            "proportions": noisy_probs.copy(),
                            "uncertainty": probs_uncertainty.copy()
                        })
                    
                    alive[elim_idx] = False
        
        return {
            "final_counts": tallies,
            "elected": np.where(elected)[0],
            "transfer_flows": transfer_flows
        }
    
    def _analyze_simulation_results(self, 
                                  all_final_counts: List[np.ndarray],
                                  all_elected: List[np.ndarray],
                                  all_transfer_flows: List[List[Dict[str, Any]]],
                                  names: List[str],
                                  parties: List[str],
                                  quota: float) -> Dict[str, Any]:
        """Analyze Monte Carlo simulation results."""
        
        n_candidates = len(names)
        n_simulations = len(all_final_counts)
        
        # Convert to arrays for analysis
        final_counts_array = np.array(all_final_counts)
        elected_array = np.zeros((n_simulations, n_candidates), dtype=bool)
        for i, elected in enumerate(all_elected):
            elected_array[i, elected] = True
        
        # Candidate-level analysis
        candidate_analysis = []
        for i in range(n_candidates):
            final_count_dist = final_counts_array[:, i]
            elected_prob = elected_array[:, i].mean()
            
            # Confidence intervals
            ci_95 = np.percentile(final_count_dist, [2.5, 97.5])
            ci_68 = np.percentile(final_count_dist, [16, 84])
            
            # Uncertainty metrics
            count_std = final_count_dist.std()
            count_cv = count_std / final_count_dist.mean() if final_count_dist.mean() > 0 else 0
            
            candidate_analysis.append({
                "name": names[i],
                "party": parties[i] if i < len(parties) else "Unknown",
                "elected_probability": float(elected_prob),
                "final_count_mean": float(final_count_dist.mean()),
                "final_count_std": float(count_std),
                "final_count_cv": float(count_cv),
                "confidence_interval_95": [float(ci_95[0]), float(ci_95[1])],
                "confidence_interval_68": [float(ci_68[0]), float(ci_68[1])],
                "quota_probability": float((final_count_dist >= quota).mean())
            })
        
        # Transfer flow uncertainty analysis
        transfer_analysis = self._analyze_transfer_uncertainty(all_transfer_flows, names, parties)
        
        # Overall uncertainty metrics
        overall_metrics = {
            "n_simulations": n_simulations,
            "mean_elected_count": elected_array.sum(axis=1).mean(),
            "elected_count_std": elected_array.sum(axis=1).std(),
            "average_transfer_uncertainty": transfer_analysis["average_uncertainty"],
            "max_transfer_uncertainty": transfer_analysis["max_uncertainty"]
        }
        
        return {
            "candidate_analysis": candidate_analysis,
            "transfer_analysis": transfer_analysis,
            "overall_metrics": overall_metrics,
            "raw_simulations": {
                "final_counts": final_counts_array,
                "elected": elected_array
            }
        }
    
    def _analyze_transfer_uncertainty(self, 
                                    all_transfer_flows: List[List[Dict[str, Any]]],
                                    names: List[str],
                                    parties: List[str]) -> Dict[str, Any]:
        """Analyze uncertainty in transfer flows across simulations."""
        
        if not all_transfer_flows:
            return {"average_uncertainty": 0.0, "max_uncertainty": 0.0, "flows": []}
        
        # Aggregate uncertainty by donor-recipient pairs
        transfer_uncertainty: Dict[Tuple[str, str], List[float]] = {}
        
        for simulation_flows in all_transfer_flows:
            for flow in simulation_flows:
                donor = flow["donor"]
                donor_party = flow["donor_party"]
                uncertainty = flow["uncertainty"]
                
                # Aggregate by donor party -> recipient party
                for i, (recipient_idx, recipient_party) in enumerate(zip(
                    range(len(flow["proportions"])), 
                    [parties[j] if j < len(parties) else "Unknown" for j in range(len(flow["proportions"]))]
                )):
                    key = (donor_party, recipient_party)
                    if key not in transfer_uncertainty:
                        transfer_uncertainty[key] = []
                    transfer_uncertainty[key].append(uncertainty[i])
        
        # Compute summary statistics
        flow_analysis = []
        for (donor_party, recipient_party), uncertainties in transfer_uncertainty.items():
            mean_uncertainty = np.mean(uncertainties)
            max_uncertainty = np.max(uncertainties)
            
            flow_analysis.append({
                "donor_party": donor_party,
                "recipient_party": recipient_party,
                "mean_uncertainty": float(mean_uncertainty),
                "max_uncertainty": float(max_uncertainty),
                "n_observations": len(uncertainties)
            })
        
        # Overall metrics
        all_uncertainties = []
        for uncertainties in transfer_uncertainty.values():
            all_uncertainties.extend(uncertainties)
        
        return {
            "average_uncertainty": float(np.mean(all_uncertainties)) if all_uncertainties else 0.0,
            "max_uncertainty": float(np.max(all_uncertainties)) if all_uncertainties else 0.0,
            "flows": flow_analysis
        }
    
    def _calculate_quota(self, valid_votes: float, seats: int) -> float:
        """Calculate election quota."""
        if seats == 1:
            return valid_votes / 2.0 + 1.0
        else:
            return np.floor(valid_votes / (seats + 1)) + 1.0