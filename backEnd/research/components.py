"""Offline candidate primitives. No web, wallet, MongoDB or runtime imports."""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
from scipy.stats import rankdata


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    # Exclusive creation prevents replacing earlier research evidence.
    with Path(path).open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)


def fit_hawkes(series):
    """Shared day-binned Hawkes/Poisson approximation, not intraday Hawkes.

    Kernel at lag d>=1 is (1-exp(-beta))*exp(-beta*(d-1)).
    Same-day events never predict one another. First 30 days are burn-in.
    Absolute observation window is source-relative; left truncation is disclosed.
    """
    usable = [np.asarray(s, dtype=float) for s in series if len(s) >= 10]
    if not usable:
        return {"available": False, "mu": 0.0, "alpha": 0.0, "beta": 1 / 7,
                "method": "unavailable: insufficient training sequences"}
    origin = min(float(s.min()) for s in usable)
    end = max(float(s.max()) for s in usable)
    days = int(end - origin) + 1
    if days < 40 or days > 10000:
        raise ValueError("Unsupported daily observation window")
    counts = np.stack([np.bincount((s - origin).astype(int), minlength=days) for s in usable])
    outcomes = counts[:, 30:].ravel()
    candidates = []
    for beta in (1 / 3, 1 / 7, 1 / 30):
        decay = math.exp(-beta)
        z = np.zeros_like(counts, dtype=float)
        for day in range(1, days):
            z[:, day] = decay * z[:, day - 1] + (1 - decay) * counts[:, day - 1]
        exposure = z[:, 30:].ravel()

        def objective(params):
            mu, alpha = params
            intensity = mu + alpha * exposure
            return float(np.mean(intensity - outcomes * np.log(intensity)))

        result = minimize(objective, [max(0.01, outcomes.mean()), 0.1],
                          bounds=[(1e-6, 1000), (0, 0.95)], method="L-BFGS-B")
        if result.success and np.isfinite(result.fun):
            candidates.append((result.fun, beta, result.x.tolist()))
    if not candidates:
        raise ValueError("Daily self-excitation fit failed")
    loss, beta, (mu, alpha) = min(candidates)
    return {"available": True, "mu": mu, "alpha": alpha, "beta": beta,
            "trainingLoss": loss, "providers": len(usable), "days": days,
            "branchingParameterAtBound": bool(alpha >= .95 - 1e-6),
            "method": "training-only pooled day-binned self-exciting Poisson; 30-day burn-in; alpha<1; 90-day inference truncation"}


def temporal_features(lags, artifact):
    values = np.asarray(lags, dtype=float)
    if np.any(~np.isfinite(values)) or np.any(values < 1) or np.any(values > 90):
        raise ValueError("History must be strictly prior date-level observations within 90 days")
    beta = artifact["beta"]
    excitation = (1 - math.exp(-beta)) * float(np.exp(-beta * (values - 1)).sum())
    if artifact.get('mode') == 'provider_normalized_daily':
        baseline = (len(values) + 30 * artifact['mu']) / 120
        intensity = artifact['baselineScale'] * baseline + artifact['alpha'] * excitation
        return {'temporal_hawkes_intensity': math.log1p(intensity / max(baseline, 1e-6)),
                'temporal_hawkes_excitation': math.log1p(excitation / max(baseline, 1e-6)),
                'temporal_hawkes_available': float(artifact['available'])}
    return {"temporal_hawkes_intensity": math.log1p(artifact["mu"] + artifact["alpha"] * excitation),
            "temporal_hawkes_excitation": math.log1p(excitation),
            "temporal_hawkes_available": float(artifact["available"])}


def fit_calibration(probabilities, targets):
    x = np.log(np.clip(probabilities, 1e-7, 1 - 1e-7) / np.clip(1 - probabilities, 1e-7, 1))
    y = np.asarray(targets, dtype=float)
    if len(np.unique(y)) < 2:
        raise ValueError("Probability calibration needs both experimental classes")

    def objective(parameters):
        slope, intercept = parameters
        margin = slope * x + intercept
        return float(np.mean(np.logaddexp(0, margin) - y * margin) + 1e-5 * slope ** 2)

    fitted = minimize(objective, [1.0, 0.0], bounds=[(0, 20), (-20, 20)], method="L-BFGS-B")
    if not fitted.success:
        raise ValueError("Calibration optimization failed")
    return {"slope": float(fitted.x[0]), "intercept": float(fitted.x[1]), "method": "monotone_platt"}


def calibrate(probabilities, artifact):
    p = np.clip(probabilities, 1e-7, 1 - 1e-7)
    return expit(artifact["slope"] * np.log(p / (1 - p)) + artifact["intercept"])


def conformal_quantile(probabilities, targets, alpha, method='marginal'):
    if not 0 < alpha < 1 or len(probabilities) == 0:
        raise ValueError("Invalid conformal calibration")
    nonconformity = np.where(np.asarray(targets, bool), 1 - probabilities, probabilities)
    if method == 'label_conditional':
        result = {'method': 'label_conditional', 'alpha': alpha, 'counts': {}, 'unsupportedClasses': []}
        for value in (0, 1):
            scores = nonconformity[np.asarray(targets, int) == value]
            result['counts'][str(value)] = len(scores)
            k = math.ceil((len(scores) + 1) * (1 - alpha))
            # Sparse classes cannot justify an optimistic singleton decision.
            result[str(value)] = float(np.sort(scores)[k - 1]) if len(scores) >= 30 and k <= len(scores) else 1.0
            if len(scores) < 30:
                result['unsupportedClasses'].append(value)
        return result
    if method != 'marginal':
        raise ValueError('Unsupported conformal method')
    k = math.ceil((len(nonconformity) + 1) * (1 - alpha))
    return float(np.sort(nonconformity)[k - 1]) if k <= len(nonconformity) else 1.0


def prediction_sets(probabilities, quantile):
    if isinstance(quantile, dict):
        if quantile.get('method') != 'label_conditional':
            raise ValueError('Unsupported conformal artifact')
        return np.column_stack([probabilities <= quantile['0'], 1 - probabilities <= quantile['1']])
    return np.column_stack([probabilities <= quantile, 1 - probabilities <= quantile])


def fit_ood(x, groups, diagnoses, min_group=30):
    x = np.asarray(x, dtype=float)
    mean, scale = x.mean(axis=0), x.std(axis=0)
    scale[scale < 1e-6] = 1.0
    z = (x - mean) / scale

    def group_fit(values):
        center = values.mean(axis=0)
        cov = np.atleast_2d(np.cov(values, rowvar=False))
        cov = 0.8 * cov + 0.2 * np.diag(np.diag(cov)) + 1e-3 * np.eye(z.shape[1])
        return {"mean": center.tolist(), "precision": np.linalg.inv(cov).tolist(), "count": len(values)}

    fitted = {"pooled": group_fit(z)}
    for prefix, labels in (("treatment:", groups), ("diagnosis:", diagnoses)):
        for label in sorted(set(labels)):
            if not label:
                continue
            selected = z[np.asarray(labels) == label]
            if len(selected) >= min_group:
                fitted[prefix + label] = group_fit(selected)
    return {"mean": mean.tolist(), "scale": scale.tolist(), "groups": fitted,
            "minimumGroup": min_group, "shrinkage": 0.2, "ridge": 0.001}


def ood_distances(x, groups, diagnoses, artifact):
    z = (np.asarray(x) - artifact["mean"]) / artifact["scale"]
    distances, sources = [], []
    for row, group, diagnosis in zip(z, groups, diagnoses):
        key = "diagnosis:" + diagnosis
        if not diagnosis or key not in artifact["groups"]:
            key = "treatment:" + group
        if key not in artifact["groups"]:
            key = "pooled"
        params = artifact["groups"][key]
        delta = row - params["mean"]
        distances.append(math.sqrt(max(0.0, float(delta @ np.asarray(params["precision"]) @ delta))))
        sources.append(key.split(":")[0])
    return np.asarray(distances), sources


def confusion(y, decisions):
    y, decisions = np.asarray(y, bool), np.asarray(decisions, bool)
    tp, fp = int((y & decisions).sum()), int((~y & decisions).sum())
    fn, tn = int((y & ~decisions).sum()), int((~y & ~decisions).sum())
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": tp / max(1, tp + fp), "recall": tp / max(1, tp + fn),
            "f1": 2 * tp / max(1, 2 * tp + fp + fn), "reviewRate": float(decisions.mean()),
            "unmutatedRouteRate": fp / max(1, fp + tn),
            "cost": (10 * fn + fp + 0.25 * (tp + fp)) / max(1, len(y))}


def select_threshold(p, y, mandatory, budget):
    # Whole-score ties and union budget, with explicit unavoidable-review rate.
    mandatory = np.asarray(mandatory, bool)
    effective = max(budget, float(mandatory.mean()))
    points = []
    for threshold in np.r_[1 + 1e-12, np.unique(p)]:
        stats = confusion(y, mandatory | (p >= threshold))
        if stats["reviewRate"] <= effective + 1e-12:
            points.append((stats["cost"], stats["reviewRate"], -threshold, stats))
    _, _, negative, stats = min(points, key=lambda value: value[:3])
    return {"threshold": float(-negative), "requestedBudget": budget, "effectiveBudget": effective,
            "unavoidableRate": float(mandatory.mean()), "validation": stats}


def probability_metrics(p, y):
    p, y = np.asarray(p, float), np.asarray(y, bool)
    positives, negatives = int(y.sum()), int((~y).sum())
    auc = float((rankdata(p)[y].sum() - positives * (positives + 1) / 2) / (positives * negatives)) if positives and negatives else None
    order = np.argsort(-p, kind="stable")
    sorted_y, sorted_p = y[order], p[order]
    ends = np.r_[np.where(np.diff(sorted_p) != 0)[0], len(p) - 1]
    tp = np.cumsum(sorted_y)[ends]
    recall = tp / max(1, positives)
    ap = float(np.sum(np.diff(np.r_[0, recall]) * tp / (ends + 1)))
    ece = 0.0
    bins = np.minimum(9, np.floor(p * 10).astype(int))
    for index in range(10):
        selected = bins == index
        if selected.any():
            ece += selected.mean() * abs(p[selected].mean() - y[selected].mean())
    return {"brier": float(np.mean((p - y) ** 2)), "ece10": float(ece), "rocAuc": auc, "averagePrecision": ap}


def paired_bootstrap(y, full, baseline, providers, seed, repetitions=500):
    # Paired provider clusters. Patient overlap between providers remains a caveat.
    ids = sorted(set(providers))
    contributions = []
    for provider in ids:
        mask = np.asarray(providers) == provider
        contributions.append([sum(mask), confusion(y[mask], full[mask]), confusion(y[mask], baseline[mask])])
    counts = np.asarray([row[0] for row in contributions])
    costs = np.asarray([[10 * stat["fn"] + stat["fp"] + 0.25 * (stat["tp"] + stat["fp"]) for stat in row[1:]] for row in contributions])
    rng = np.random.default_rng(seed)
    differences = []
    for _ in range(repetitions):
        selected = rng.integers(0, len(ids), len(ids))
        totals = costs[selected].sum(axis=0) / counts[selected].sum()
        differences.append(totals[0] - totals[1])
    return {"costDifference": confusion(y, full)["cost"] - confusion(y, baseline)["cost"],
            "percentile95": np.quantile(differences, [0.025, 0.975]).tolist(), "clusters": len(ids),
            "repetitions": repetitions, "scope": "exploratory paired provider bootstrap; no multiplicity-adjusted superiority claim"}
