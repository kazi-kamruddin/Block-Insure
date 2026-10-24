"""Phase 1/2 orchestrator. Offline only. Run with the pinned research Python."""
import os
# Set before NumPy/XGBoost load; do not take all cores on the development PC.
for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[variable] = "1"

import argparse
import copy
import json
import platform
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import scipy
from scipy.optimize import minimize
from scipy.special import expit
import xgboost as xgb

from components import (digest, save, fit_hawkes, temporal_features, fit_ood, ood_distances,
                        fit_calibration, calibrate, conformal_quantile, prediction_sets,
                        select_threshold, confusion, probability_metrics, paired_bootstrap)

ROOT = Path(__file__).resolve().parents[2]
PARTS = ("train", "tune", "probability", "conformal", "policy", "test")


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def fit_logistic(x, y):
    mean, scale = x.mean(axis=0), x.std(axis=0)
    scale[scale < 1e-6] = 1
    z = (x - mean) / scale

    def loss(w):
        margin = z @ w[:-1] + w[-1]
        objective = np.mean(np.logaddexp(0, margin) - y * margin) + 0.001 * (w[:-1] @ w[:-1])
        error = expit(margin) - y
        gradient = np.r_[z.T @ error / len(y) + 0.002 * w[:-1], error.mean()]
        return objective, gradient

    fitted = minimize(loss, np.zeros(x.shape[1] + 1), jac=True, method="L-BFGS-B", options={"maxiter": 500})
    if not fitted.success:
        raise ValueError("LR baseline did not converge")
    return {"mean": mean.tolist(), "scale": scale.tolist(), "weights": fitted.x[:-1].tolist(), "bias": float(fitted.x[-1])}


def logistic_predict(artifact, x):
    return expit(((x - artifact["mean"]) / artifact["scale"]) @ artifact["weights"] + artifact["bias"])


def fit_nb(x, y):
    p = [(x[y == value].sum(axis=0) + 1) / (int((y == value).sum()) + 2) for value in (0, 1)]
    return {"p": np.asarray(p).tolist(), "priors": [(int((y == v).sum()) + 1) / (len(y) + 2) for v in (0, 1)]}


def nb_predict(artifact, x):
    p = np.asarray(artifact["p"])
    margins = np.column_stack([x @ np.log(p[v]) + (1 - x) @ np.log(1 - p[v]) + np.log(artifact["priors"][v]) for v in (0, 1)])
    return expit(margins[:, 1] - margins[:, 0])


def train_tree(matrices, y, names, plan, seed):
    selected = []
    for depth in plan["depthCandidates"]:
        booster = xgb.train({"objective": "binary:logistic", "eval_metric": "logloss", "tree_method": "hist",
                             "max_depth": depth, "eta": 0.08, "min_child_weight": 3, "lambda": 2,
                             "base_score": 0.5, "nthread": 1, "seed": seed},
                            xgb.DMatrix(matrices["train"], label=y["train"], feature_names=names, nthread=1),
                            num_boost_round=plan["maxTrees"],
                            evals=[(xgb.DMatrix(matrices["tune"], label=y["tune"], feature_names=names, nthread=1), "tune")],
                            early_stopping_rounds=10, verbose_eval=False)
        selected.append((booster.best_score, depth, booster[:booster.best_iteration + 1]))
    _, depth, booster = min(selected, key=lambda item: item[:2])
    booster.set_param({"nthread": 1})
    return booster, {"depth": depth, "trees": booster.num_boosted_rounds(), "selection": "tuning partition log loss only"}


def sets_report(p, y, q):
    sets = prediction_sets(p, q)
    covered = sets[np.arange(len(y)), y.astype(int)]
    singleton = sets.sum(axis=1) == 1
    predicted = sets[:, 1]
    return {"coverage": float(covered.mean()), "classCoverage": {str(v): float(covered[y == v].mean()) for v in (0, 1)},
            "meanSetSize": float(sets.sum(axis=1).mean()), "ambiguousOrEmptyRate": float((~singleton).mean()),
            "singletonCount": int(singleton.sum()), "singletonError": float((predicted[singleton] != y[singleton]).mean()) if singleton.any() else None,
            "note": ('Label-conditional empirical coverage; only robust to prior shift if within-class exchangeability holds, not arbitrary provider/conditional shift' if isinstance(q, dict) else 'Marginal empirical coverage only; v1 calibration/test prevalence differs and exchangeability is not assured')}


def route_outputs(probabilities, labels, mandatory, ood, threshold, q, use_conformal, use_ood):
    result, unavoidable = {}, {}
    for part in PARTS:
        p = probabilities[part]
        sets = prediction_sets(p, q)
        additional = (~(sets[:, 0] & ~sets[:, 1])) if use_conformal else np.zeros(len(p), bool)
        unavoidable[part] = mandatory[part] | additional | (ood[part] if use_ood else False)
        result[part] = unavoidable[part] | (p >= threshold)
    return result, unavoidable


def evaluate(seed, directory, output, plan, hawkes):
    print(f"Seed {seed}: loading isolated partitions", flush=True)
    rows = {part: read(directory / f"{seed}-{part}.json") for part in PARTS}
    # Defense in depth: exported group integrity is independently checked.
    for index, a in enumerate(PARTS):
        for b in PARTS[index + 1:]:
            for key in ("patient", "provider", "id"):
                if {r[key] for r in rows[a]} & {r[key] for r in rows[b]}:
                    raise ValueError("Exported partitions overlap")
    y = {p: np.array([r["target"] for r in rows[p]], bool) for p in PARTS}
    mandatory = {p: np.array([r["mandatory"] for r in rows[p]], bool) for p in PARTS}
    features = {}
    for part in PARTS:
        features[part] = [{**r["features"], **temporal_features(r["providerLags"], hawkes)} for r in rows[part]]
    names = sorted(features["train"][0])
    x = {p: np.asarray([[r[name] for name in names] for r in features[p]], dtype=np.float32) for p in PARTS}
    if any(not np.isfinite(value).all() for value in x.values()):
        raise ValueError("Nonfinite model input")
    base_names = [n for n in names if not n.startswith(("history_", "graph_", "temporal_"))]
    binary_names = [n for n in base_names if n not in ("log_bill", "bill_to_expected_max", "care_days", "invoice_lag_days", "log_prior_claims")]
    groups = {p: [r["group"] for r in rows[p]] for p in PARTS}
    diagnoses = {p: [r["diagnosis"] for r in rows[p]] for p in PARTS}
    ood_names = ["log_bill", "bill_to_expected_max", "care_days", "invoice_lag_days", "history_provider30", "graph_provider_hhi", "temporal_hawkes_excitation"]
    ood_x = {p: x[p][:, [names.index(n) for n in ood_names]] for p in PARTS}
    ood_artifact = fit_ood(ood_x["train"], groups["train"], diagnoses["train"])
    distance_source = {p: ood_distances(ood_x[p], groups[p], diagnoses[p], ood_artifact) for p in PARTS}
    distances = {p: values[0] for p, values in distance_source.items()}
    ood_threshold = float(np.quantile(distances["tune"], 0.99, method="higher"))
    ood = {p: distances[p] > ood_threshold for p in PARTS}
    all_names = names + ["ood_distance"]
    all_x = {p: np.column_stack([x[p], distances[p]]).astype(np.float32) for p in PARTS}
    reports = {"rules_only": {"routing": confusion(y["test"], mandatory["test"])}}
    decisions = {"rules_only": mandatory["test"]}
    models = {}

    variants = {
        "gbdt_base": base_names,
        "gbdt_full": all_names,
        "without_history": [n for n in all_names if not n.startswith("history_")],
        "without_graph": [n for n in all_names if not n.startswith("graph_")],
        "without_temporal": [n for n in all_names if not n.startswith("temporal_")],
        "without_ood": names,
    }
    # Refit OOD without removed inputs, rather than disable unrelated safeguards.
    for variant, selected_names in variants.items():
        print(f"Seed {seed}: {variant}", flush=True)
        variant_ood = ood
        variant_x = all_x
        if variant in ('without_history', 'without_graph', 'without_temporal'):
            prefix = {'without_history': 'history_', 'without_graph': 'graph_', 'without_temporal': 'temporal_'}[variant]
            retained = [n for n in ood_names if not n.startswith(prefix)]
            ox = {p: x[p][:, [names.index(n) for n in retained]] for p in PARTS}
            oa = fit_ood(ox['train'], groups['train'], diagnoses['train'])
            ds = {p: ood_distances(ox[p], groups[p], diagnoses[p], oa)[0] for p in PARTS}
            threshold = float(np.quantile(ds['tune'], .99, method='higher'))
            variant_ood = {p: ds[p] > threshold for p in PARTS}
            variant_x = {p: np.column_stack([x[p], ds[p]]).astype(np.float32) for p in PARTS}
        matrices = {p: variant_x[p][:, [all_names.index(n) for n in selected_names]] for p in PARTS}
        start = time.perf_counter()
        booster, settings = train_tree(matrices, y, selected_names, plan, seed)
        training_seconds = time.perf_counter() - start
        raw = {p: (expit(booster.predict(xgb.DMatrix(matrices[p], feature_names=selected_names, nthread=1), output_margin=True).astype(float))
                   if plan.get('schemaVersion') == 'advanced-study-v2' else booster.predict(xgb.DMatrix(matrices[p], feature_names=selected_names, nthread=1))) for p in PARTS}
        calibration = fit_calibration(raw["probability"], y["probability"])
        probabilities = {p: calibrate(raw[p], calibration) for p in PARTS}
        q = conformal_quantile(probabilities["conformal"], y["conformal"], plan["conformalAlpha"], method=plan.get('conformalMethod', 'marginal'))
        use_context_routing = variant != 'gbdt_base'
        use_ood = variant not in ('gbdt_base', 'without_ood')
        _, unavoidable = route_outputs(probabilities, y, mandatory, variant_ood, 2, q, use_context_routing, use_ood)
        operating = select_threshold(probabilities["policy"], y["policy"], unavoidable["policy"], plan["requestedReviewBudget"])
        routed, _ = route_outputs(probabilities, y, mandatory, variant_ood, operating["threshold"], q, use_context_routing, use_ood)
        decisions[variant] = routed["test"]
        reports[variant] = {"routing": confusion(y["test"], routed["test"]), "probability": probability_metrics(probabilities["test"], y["test"]),
                            "operatingPoint": operating, "trainingSeconds": training_seconds, "model": settings,
                            "conformal": sets_report(probabilities["test"], y["test"], q)}
        if variant not in ('gbdt_base', 'gbdt_full'):
            reports[variant]['ablationBoundary'] = 'New component removed from predictor and OOD inputs; OOD refit, all other gates retained. Legacy binary/base features remain common to all methods.'
        models[variant] = {"booster": booster, "names": selected_names, "matrices": matrices,
                           "calibration": calibration, "q": q, "raw": raw, "probabilities": probabilities, "operating": operating}

    full = models["gbdt_full"]
    for variant in ("without_calibration", "without_conformal"):
        p = full["raw"] if variant == "without_calibration" else full["probabilities"]
        q = conformal_quantile(p["conformal"], y["conformal"], plan["conformalAlpha"], method=plan.get('conformalMethod', 'marginal'))
        use_cp = variant != "without_conformal"
        _, u = route_outputs(p, y, mandatory, ood, 2, q, use_cp, True)
        op = select_threshold(p["policy"], y["policy"], u["policy"], plan["requestedReviewBudget"])
        routes, _ = route_outputs(p, y, mandatory, ood, op["threshold"], q, use_cp, True)
        decisions[variant] = routes["test"]
        reports[variant] = {"routing": confusion(y["test"], routes["test"]), "probability": probability_metrics(p["test"], y["test"]), "operatingPoint": op}

    # The frozen application model is a separate baseline, not retrained in place.
    active_nb = read(ROOT / 'backEnd/model-params.json')
    active_policy = read(ROOT / 'backEnd/triage-policy.json')
    active_names = active_nb['featureNames']
    active_artifact = {'p': [[active_nb['featureProbabilities'][n][label]['present'] for n in active_names] for label in ('legitimate', 'fraud')],
                       'priors': [active_nb['classPrior']['legitimate'], active_nb['classPrior']['fraud']]}
    active_p = nb_predict(active_artifact, x['test'][:, [names.index(n) for n in active_names]])
    active_cal = active_nb['calibration']
    if active_cal['method'] != 'platt':
        raise ValueError('Explicit support required for this active calibration method')
    active_p = calibrate(active_p, active_cal)
    decisions['frozen_runtime_nb'] = mandatory['test'] | (active_p >= active_policy['routing']['manualReviewThreshold'])
    reports['frozen_runtime_nb'] = {'routing': confusion(y['test'], decisions['frozen_runtime_nb']), 'probability': probability_metrics(active_p, y['test']),
                                    'scope': 'Frozen active parameters, offline observable features and common mandatory rules; not an authenticated browser replay'}
    # Same exported cases, same calibration/policy partitions; no test tuning.
    for variant in ("observable_nb", "binary_lr", "continuous_lr"):
        selected = binary_names if variant != "continuous_lr" else base_names
        matrices = {p: x[p][:, [names.index(n) for n in selected]] for p in PARTS}
        if variant == "observable_nb":
            artifact = fit_nb(matrices["train"], y["train"])
            raw = {p: nb_predict(artifact, matrices[p]) for p in PARTS}
        else:
            artifact = fit_logistic(matrices["train"], y["train"])
            raw = {p: logistic_predict(artifact, matrices[p]) for p in PARTS}
        calibration = fit_calibration(raw["probability"], y["probability"])
        p = {part: calibrate(raw[part], calibration) for part in PARTS}
        op = select_threshold(p["policy"], y["policy"], mandatory["policy"], plan["requestedReviewBudget"])
        decisions[variant] = mandatory["test"] | (p["test"] >= op["threshold"])
        reports[variant] = {"routing": confusion(y["test"], decisions[variant]), "probability": probability_metrics(p["test"], y["test"]), "operatingPoint": op}
        save(output / f"{seed}-{variant}.json", {"features": selected, "model": artifact, "calibration": calibration, "policy": op})

    seed_output = output / str(seed)
    seed_output.mkdir()
    # Baseline checkpoint permits stress-cohort scoring WITHOUT retraining/tuning.
    models['gbdt_base']['booster'].save_model(seed_output / 'base-model.xgb.json')
    save(seed_output / 'base-pipeline.json', {'features': models['gbdt_base']['names'], 'calibration': models['gbdt_base']['calibration'], 'policy': models['gbdt_base']['operating']})
    full["booster"].save_model(seed_output / "model.xgb.json")
    trees = [json.loads(tree) for tree in full["booster"].get_dump(dump_format="json", with_stats=True)]
    portable = {"schema": "advanced-trees-v1", "baseMargin": 0, "features": full["names"], "trees": trees}
    save(seed_output / "trees.reference.json", portable)
    rounded = copy.deepcopy(portable)

    def rounding(node):
        for key in ("leaf", "split_condition"):
            if key in node:
                node[key] = round(node[key], 6)
        for child in node.get("children", []):
            rounding(child)
    for tree in rounded["trees"]:
        rounding(tree)
    save(seed_output / "trees.rounded6.json", rounded)
    save(seed_output / "parity-input.json", full["matrices"]["test"].astype(float).tolist())

    def js_predictions(model):
        response = subprocess.run(["node", str(Path(__file__).with_name("predict.js")), str(seed_output / model), str(seed_output / "parity-input.json")], check=True, capture_output=True, text=True)
        return json.loads(response.stdout)

    reference = js_predictions("trees.reference.json")
    quantized = js_predictions("trees.rounded6.json")
    original = full["raw"]["test"]
    margin = full["booster"].predict(xgb.DMatrix(full["matrices"]["test"], feature_names=full["names"], nthread=1), output_margin=True)
    contributions = full["booster"].predict(xgb.DMatrix(full["matrices"]["test"], feature_names=full["names"], nthread=1), pred_contribs=True, approx_contribs=False)
    max_additivity_error = float(np.max(np.abs(contributions.sum(axis=1) - margin)))
    reference_error = float(np.max(np.abs(np.array([r["probability"] for r in reference]) - original)))
    quantized_p = np.array([r["probability"] for r in quantized])
    reference_cal = calibrate(np.array([r['probability'] for r in reference]), full['calibration'])
    reference_sets = prediction_sets(reference_cal, full['q'])
    reference_routes = mandatory['test'] | ood['test'] | ~(reference_sets[:, 0] & ~reference_sets[:, 1]) | (reference_cal >= full['operating']['threshold'])
    quantized_cal = calibrate(quantized_p, full["calibration"])
    qsets = prediction_sets(quantized_cal, full["q"])
    quantized_routes = mandatory["test"] | ood["test"] | ~(qsets[:, 0] & ~qsets[:, 1]) | (quantized_cal >= full["operating"]["threshold"])
    if reference_error > 1e-6 or max_additivity_error > 1e-4:
        raise ValueError("Portable prediction or native SHAP additivity mismatch")
    parity = {"rows": len(original), "referenceMaxProbabilityError": reference_error,
              "referenceRoutingDifferences": int((reference_routes != decisions['gbdt_full']).sum()),
              "rounded6MaxProbabilityError": float(np.max(np.abs(quantized_p - original))),
              "rounded6RoutingDifferences": int((quantized_routes != decisions["gbdt_full"]).sum()),
              "shapRawMarginMaxAdditivityError": max_additivity_error,
              "quantizedPromotion": "REJECTED; native model retained; six-decimal probability or routing differences violate fidelity"}
    # SHAP describes the actual unrounded native model, on margin scale.
    explanation_examples = []
    for i in range(min(12, len(original))):
        order = np.argsort(-np.abs(contributions[i, :-1]))[:8]
        explanation_examples.append({"example": i, "modelMargin": float(margin[i]), "baseMargin": float(contributions[i, -1]),
                                     "topContributions": [{"feature": full["names"][j], "value": float(contributions[i, j])} for j in order]})
    save(seed_output / "explanation-examples.json", explanation_examples)
    save(seed_output / "pipeline.json", {"schemaVersion": 'advanced-candidate-v2' if plan.get('schemaVersion') == 'advanced-study-v2' else 'advanced-candidate-v1', "authority": "OFFLINE_ONLY", "features": full["names"],
         'probabilityContract': 'float64_sigmoid_of_float32_margin' if plan.get('schemaVersion') == 'advanced-study-v2' else 'native_float32_sigmoid',
         "hawkes": hawkes, "ood": {"features": ood_names, "parameters": ood_artifact, "threshold": ood_threshold},
         "calibration": full["calibration"], "conformal": {"alpha": plan["conformalAlpha"], "quantile": full["q"]},
         "policy": full["operating"], "modelSha256": digest(seed_output / "model.xgb.json"),
         "referenceSha256": digest(seed_output / "trees.reference.json"),
         "contextContract": "context.js; group-local prior 90-day history, same-day excluded; no runtime commitment yet"})
    save(seed_output / 'receipt.json', {'pipelineSha256': digest(seed_output / 'pipeline.json'),
                                       'modelSha256': digest(seed_output / 'model.xgb.json'),
                                       'scope': 'Integrity receipt, not proof of publisher authenticity'})
    example = rows['test'][0]
    save(seed_output / 'example-input.json', {key: example[key] for key in ('features', 'providerLags', 'group', 'diagnosis', 'mandatory')})
    from infer import assess, prepare
    pipeline = read(seed_output / 'pipeline.json')
    rebuilt = np.concatenate([prepare(pipeline, row)[0] for row in rows['test']], axis=0)
    if not np.array_equal(rebuilt, full['matrices']['test']):
        raise ValueError('Packaged preprocessing/OOD differs from training reference')
    parity['packagedPreprocessingRowsExactlyMatched'] = len(rebuilt)
    assessed = assess(seed_output, example)
    if abs(assessed.get('riskScore', -1) - float(full['probabilities']['test'][0])) > 1e-6:
        raise ValueError('Packaged inference parity failed')
    save(seed_output / 'example-assessment.json', assessed)
    # Compare BOTH rules and the calibrated retrained observable NB.
    intervals = {name: paired_bootstrap(y["test"], decisions["gbdt_full"], decisions[name], [r["provider"] for r in rows["test"]], seed, plan["bootstrapReplicates"])
                 for name in ("rules_only", "observable_nb", 'frozen_runtime_nb')}
    cases = {}
    for scenario in sorted({r["scenario"] for r in rows["test"]}):
        selected = np.array([r["scenario"] == scenario for r in rows["test"]])
        cases[scenario] = {"records": int(selected.sum()), "attacks": int(y["test"][selected].sum()),
                           "fullRouted": int(decisions["gbdt_full"][selected].sum()), "rulesRouted": int(mandatory["test"][selected].sum())}
    # Model-only batch + single-row timing; upstream history/graph cost excluded.
    times = []
    for row in full["matrices"]["test"][:30]:
        data = xgb.DMatrix(row.reshape(1, -1), feature_names=full["names"], nthread=1)
        start = time.perf_counter()
        full["booster"].predict(data)
        times.append(1000 * (time.perf_counter() - start))
    summary = {"seed": seed, "partitions": {p: {"records": len(y[p]), "attackRate": float(y[p].mean()), "providers": len({r['provider'] for r in rows[p]})} for p in PARTS},
               "methods": reports, "pairedUncertainty": intervals, "scenarios": cases, "parity": parity,
               "ood": {"threshold": ood_threshold, "testWarningRate": float(ood["test"].mean()), "groupFallbackCounts": {key: distance_source["test"][1].count(key) for key in ("diagnosis", "treatment", "pooled")}},
               "modelOnlyLatencyMs": {"p50": float(np.median(times)), "p95": float(np.quantile(times, .95)), "samples": len(times), "excludes": "context building, graph, OOD, SHAP, storage/network"}}
    if any(np.any(mandatory["test"] & ~decision) for decision in decisions.values()):
        raise ValueError("Mandatory rule bypass")
    save(output / f"{seed}-evaluation.json", summary)
    return summary


def run(directory):
    directory = Path(directory).resolve()
    allowed = (ROOT / "docs/engineered").resolve()
    if directory.parent != allowed or not directory.name.startswith("advanced-"):
        raise ValueError("Expected an ignored docs/engineered/advanced-* input directory")
    inputs = read(directory / "input-manifest.json")
    for name, expected in inputs["files"].items():
        if digest(directory / name) != expected:
            raise ValueError("Input checksum mismatch")
    for name, expected in inputs["sourceFiles"].items():
        if digest(ROOT / name) != expected:
            raise ValueError("Export source changed; export again")
    plan = read(directory / "plan.json")
    # Source tree is frozen before training and verified again before publishing.
    source = {p.name: digest(p) for p in Path(__file__).parent.iterdir() if p.suffix in (".py", ".js", ".json", ".txt")}
    output = directory / ("study-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    output.mkdir()
    save(output / "prospective-record.json", {"recordedBeforeTraining": True, "sourceSha256": source, "plan": plan,
         "inputManifestSha256": digest(directory / "input-manifest.json"), "environment": {"python": sys.version, "platform": platform.platform(), "numpy": np.__version__, "scipy": scipy.__version__, "xgboost": xgb.__version__, "threads": 1}})
    hawkes = fit_hawkes(read(directory / "training-series.json"))
    save(output / "hawkes.json", hawkes)
    results = [evaluate(seed, directory, output, plan, hawkes) for seed in plan["seeds"]]
    for name, expected in source.items():
        if digest(Path(__file__).parent / name) != expected:
            raise ValueError("Research source changed during study")
    for name, expected in inputs["sourceFiles"].items():
        if digest(ROOT / name) != expected:
            raise ValueError("Runtime/export source changed during study")
    summary = {"scope": plan["scope"], "priorExposure": plan["priorExposure"], "seeds": plan["seeds"],
               "promotion": "HOLD", "reason": "Exploratory reused source/scenarios; no Phase 3 authenticated context/runtime integration. Metrics do not automatically authorize promotion.",
               "meanRouting": {name: {key: float(np.mean([r["methods"][name]["routing"][key] for r in results])) for key in ("cost", "recall", "f1", "reviewRate")} for name in results[0]["methods"]},
               "hawkes": hawkes, "limitations": ["Controlled modifications, not natural fraud ground truth", "Shared source/scenario construction, not independent dataset replication", "No real bank graph", "Date-resolution approximate Hawkes; left truncation and 90-day inference window; shared provider rates can confound excitation", "Sparse diagnosis groups use treatment/pooled OOD fallback", "Conformal coverage not guaranteed across injection-prevalence or provider shift", "Graph rankings are structural, not proof of collusion", "Component ablations refit OOD with removed component excluded; all other gates retained", "Phase 1/2 only; no runtime promotion, contract change or hosted deployment", "Native exact path-dependent SHAP is explanatory, not causal or calibrated-percentage attribution"]}
    summary['promotionChecks'] = {
        'lowerMeanCostThanRules': summary['meanRouting']['gbdt_full']['cost'] < summary['meanRouting']['rules_only']['cost'],
        'allSeedCostIntervalsExcludeZeroVsRulesAndNB': all(r['pairedUncertainty'][name]['percentile95'][1] < 0 for r in results for name in ('rules_only', 'observable_nb', 'frozen_runtime_nb')),
        'allSeedEmpiricalConformalCoverageAtNominal': all(r['methods']['gbdt_full']['conformal']['coverage'] >= 1 - plan['conformalAlpha'] for r in results),
        'allSeedReferenceRoutingParity': all(r['parity']['referenceRoutingDifferences'] == 0 for r in results),
        'independentConfirmatoryEvidence': False, 'runtimeContextCommitments': False,
        'note': 'Diagnostic gates, not post-hoc new success criteria; raw confidence intervals are exploratory and not multiplicity adjusted.'}
    all_test_ids = [r['id'] for seed in plan['seeds'] for r in read(directory / f'{seed}-test.json')]
    summary['testRows'] = {'evaluations': len(all_test_ids), 'uniqueSourceClaims': len(set(all_test_ids)), 'overlappingSamplingSeeds': True}
    for name, expected in inputs['files'].items():
        if digest(directory / name) != expected:
            raise ValueError('Input changed during study; summary withheld')
    save(output / "study-summary.json", summary)
    # Portable prediction command can be used without the source dataset.
    print(json.dumps({"output": str(output), "promotion": "HOLD", "meanRouting": summary["meanRouting"]}, indent=2), flush=True)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    run(parser.parse_args().directory)
