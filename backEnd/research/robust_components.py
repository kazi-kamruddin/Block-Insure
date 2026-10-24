"""Additive v2 experiments; original v1 evidence and active model remain intact."""
import math
import numpy as np
from scipy.optimize import minimize


def fit_normalized_hawkes(series):
    usable = [np.asarray(values, dtype=float) for values in series if len(values) >= 10]
    if not usable:
        raise ValueError('Insufficient temporal reference histories')
    origin = min(float(s.min()) for s in usable)
    end = max(float(s.max()) for s in usable)
    days = int(end - origin) + 1
    if not 80 <= days <= 10000:
        raise ValueError('Temporal reference window too short/large')
    counts = np.stack([np.bincount((s - origin).astype(int), minlength=days) for s in usable]).astype(float)
    cutoff = int(days * .8)
    mu = float(counts[:, :cutoff].mean())
    cumulative = np.column_stack([np.zeros(len(counts)), np.cumsum(counts, axis=1)])
    prior = np.stack([cumulative[:, d] - cumulative[:, max(0, d - 90)] for d in range(days)], axis=1)
    baseline = (prior + 30 * mu) / 120
    fit_mask = np.zeros_like(counts, bool); fit_mask[:, 90:cutoff] = True
    valid_mask = np.zeros_like(counts, bool); valid_mask[:, cutoff:] = True
    if not fit_mask.any() or not valid_mask.any():
        raise ValueError('Insufficient chronological training-validation window')

    def loss(intensity, mask):
        values = np.maximum(1e-8, intensity[mask])
        return float(np.mean(values - counts[mask] * np.log(values)))

    poisson = minimize(lambda parameters: loss(parameters[0] * baseline, fit_mask), [1.0], bounds=[(.25, 4)], method='L-BFGS-B')
    if not poisson.success:
        raise ValueError('Poisson reference fit failed')
    candidates = [{'alpha': 0.0, 'baselineScale': float(poisson.x[0]), 'beta': 1 / 7,
                   'validationLoss': loss(poisson.x[0] * baseline, valid_mask), 'selection': 'Poisson reference'}]
    for beta in (1 / 3, 1 / 7, 1 / 30):
        decay = math.exp(-beta)
        exposure = np.zeros_like(counts)
        for day in range(1, days):
            exposure[:, day] = decay * exposure[:, day - 1] + (1 - decay) * counts[:, day - 1]
            if day > 90:
                exposure[:, day] -= (1 - decay) * decay ** 90 * counts[:, day - 91]
        exposure = np.maximum(0, exposure)
        fit = minimize(lambda parameters: loss(parameters[0] * baseline + parameters[1] * exposure, fit_mask), [1.0, .1],
                       bounds=[(.25, 4), (0, .95)], method='L-BFGS-B')
        if fit.success:
            candidates.append({'alpha': float(fit.x[1]), 'baselineScale': float(fit.x[0]), 'beta': beta,
                               'validationLoss': loss(fit.x[0] * baseline + fit.x[1] * exposure, valid_mask), 'selection': 'self-excitation candidate'})
    best = min(candidates, key=lambda p: (round(p['validationLoss'], 6), p['alpha']))
    return {**best, 'mode': 'provider_normalized_daily', 'available': True, 'mu': mu,
            'providers': len(usable), 'days': days, 'trainingCutoffDay': cutoff,
            'branchingParameterAtBound': best['alpha'] >= .95 - 1e-6, 'candidates': candidates,
            'method': 'Prior-90-day provider baseline + shared self-excitation; candidate selected on chronological last 20% of training histories; no test outcomes',
            'limitation': 'Date-binned approximation, observed-window censoring and provider changes remain; alpha=0 is a valid evidence-selected outcome'}


def workload_matched_decisions(scores, mandatory, identifiers, budget):
    """Label-blind finite-cohort allocation diagnostic, NOT runtime threshold.

    Mandatory findings are retained; remaining slots filled by score, ties by
    hash ID independent of outcomes. Exact budget possible unless mandatory
    findings already exceed it. Does not preserve extra conformal/OOD gates.
    """
    scores = np.asarray(scores, float)
    mandatory = np.asarray(mandatory, bool)
    if len(scores) != len(mandatory) or len(scores) != len(identifiers) or not np.isfinite(scores).all() or not 0 <= budget <= 1:
        raise ValueError('Invalid cohort allocation input')
    decisions = mandatory.copy()
    slots = max(0, int(math.floor(len(scores) * budget)) - int(mandatory.sum()))
    ranked = sorted(np.flatnonzero(~mandatory), key=lambda i: (-scores[i], identifiers[i]))
    decisions[ranked[:slots]] = True
    return decisions
