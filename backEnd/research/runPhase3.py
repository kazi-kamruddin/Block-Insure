"""Versioned balanced advisory policy. Original studies/models are immutable.

Existing policy partitions select operating points. Test cohorts never select
the runtime seed, threshold or components. Uncertainty remains visible but does
not independently compel review in this new advisory-only configuration.
"""
import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[variable] = '1'
import json
import subprocess
import time
from pathlib import Path
import numpy as np
import xgboost as xgb
from scipy.special import expit
from components import digest, save, calibrate, select_threshold, confusion, paired_bootstrap
from infer import prepare

ROOT = Path(__file__).resolve().parents[2]


def read(path):
    return json.loads(Path(path).read_text())


def run():
    plan_path = Path(__file__).with_name('phase3-plan.json')
    plan = read(plan_path)
    data = ROOT / 'docs/engineered/advanced-engineering-v2-reviewed-2026-10-24'
    study = data / 'study-20261024T075106Z'
    original = read(study / 'prospective-record.json')
    inputs = read(data / 'input-manifest.json')
    for name, expected in inputs['files'].items():
        if digest(data / name) != expected:
            raise ValueError('Prepared research inputs changed')
    output = ROOT / 'docs/engineered' / ('advanced-phase3-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
    output.mkdir()
    save(output / 'plan.json', plan)
    seeds = original['plan']['seeds']
    results, runtime_bundle = [], None
    for seed in seeds:
        directory = study / str(seed)
        pipeline = read(directory / 'pipeline.json')
        receipt = read(directory / 'receipt.json')
        if digest(directory / 'pipeline.json') != receipt['pipelineSha256'] or digest(directory / 'model.xgb.json') != pipeline['modelSha256'] or digest(directory / 'trees.reference.json') != pipeline['referenceSha256']:
            raise ValueError('Frozen candidate identity mismatch')
        model = xgb.Booster(params={'nthread': 1})
        model.load_model(directory / 'model.xgb.json')
        model.set_param({'nthread': 1})

        def score(rows):
            matrix = np.concatenate([prepare(pipeline, row)[0] for row in rows])
            dm = xgb.DMatrix(matrix, feature_names=pipeline['features'], nthread=1)
            probability = calibrate(expit(model.predict(dm, output_margin=True).astype(float)), pipeline['calibration'])
            return probability, dm

        validation = read(data / f'{seed}-policy.json')
        vp, _ = score(validation)
        scale = plan['decisionScoreScale']
        decision_scores = lambda p: np.floor(p * scale + .5) / scale
        policies = {str(budget): select_threshold(decision_scores(vp), [r['target'] for r in validation], [r['mandatory'] for r in validation], budget)
                    for budget in plan['sensitivityBudgets']}
        op = policies[str(plan['primaryBudget'])]
        bundle = {
            'schemaVersion': 'xgboost-admin-bundle-v1',
            'pipeline': pipeline, 'trees': read(directory / 'trees.reference.json'),
            'policy': {'version': plan['version'], 'authority': plan['authority'], 'threshold': op['threshold'],
                       'comparisonBudget': plan['primaryBudget'], 'uncertaintyTriggersReview': False,
                       'scoreScale': scale, 'thresholdUnits': int(np.floor(op['threshold'] * scale + .5)) if op['threshold'] <= 1 else scale + 1,
                       'validation': op, 'selection': plan['selection']},
            'provenance': {'sourceStudy': str(study.relative_to(ROOT)).replace('\\', '/'), 'seed': seed,
                           'selection': plan['runtimeSelection'], 'sourcePipelineSha256': receipt['pipelineSha256'],
                           'sourceModelSha256': pipeline['modelSha256'], 'sourceReferenceSha256': pipeline['referenceSha256'],
                           'planSha256': digest(plan_path), 'labelMeaning': 'Simulator billing actions, not adjudicated fraud',
                           'decision': 'ADVISORY_DISPLAY; no Oracle protocol promotion or superiority claim'},
        }
        bundle_path = output / f'{seed}-bundle.json'
        save(bundle_path, bundle)
        cohorts = {}
        for cohort in ('test', 'test_prevalence', 'test_severity', 'test_family'):
            rows = read(data / f'{seed}-{cohort}.json')
            probability, matrix = score(rows)
            mandatory = np.array([r['mandatory'] for r in rows], bool)
            y = np.array([r['target'] for r in rows], bool)
            outcomes = {budget: confusion(y, mandatory | (decision_scores(probability) >= p['threshold'])) for budget, p in policies.items()}
            # Pass only the explicit observable contract across the runtime bridge.
            observations = [{key: row[key] for key in ('features', 'providerLags', 'group', 'diagnosis', 'mandatory')} for row in rows]
            started = time.perf_counter()
            process = subprocess.run(['node', str(ROOT / 'backEnd/scripts/scoreAdvisoryBatch.js'), str(bundle_path)],
                                     input=json.dumps(observations), capture_output=True, text=True, check=True)
            runtime = json.loads(process.stdout)
            elapsed = time.perf_counter() - started
            error = float(np.max(np.abs(probability - np.array([r['riskScore'] for r in runtime]))))
            differences = int(np.sum((mandatory | (decision_scores(probability) >= op['threshold'])) != np.array([r['recommendation'] == 'REVIEW_RECOMMENDED' for r in runtime])))
            native_shap = model.predict(matrix.slice(np.arange(20)), pred_contribs=True, approx_contribs=False)
            explanation_error = max(abs(float(native_shap[i, j]) - runtime[i]['explanation']['contributions'][name])
                                    for i in range(20) for j, name in enumerate(pipeline['features']))
            base_error = max(abs(float(native_shap[i, -1]) - runtime[i]['explanation']['base']) for i in range(20))
            if error > 1e-6 or differences or explanation_error > 1e-4 or base_error > 1e-4:
                raise ValueError(f'Runtime parity failed: {error}, {differences}, {explanation_error}, {base_error}')
            cohorts[cohort] = {'policies': outcomes, 'runtimeParity': {'rows': len(rows), 'maxProbabilityError': error,
                'routingDifferences': differences, 'shapContributionMaxError': explanation_error, 'shapBaseMaxError': base_error,
                'bridgeSeconds': elapsed, 'scope': 'Batch including process startup; 20 explained rows, not per-request latency'},
                'comparisonToRules': paired_bootstrap(y, mandatory | (decision_scores(probability) >= op['threshold']), mandatory,
                    [row['provider'] for row in rows], seed)}
        results.append({'seed': seed, 'policies': policies, 'cohorts': cohorts})
        if seed == plan['runtimeSeed']:
            runtime_bundle = bundle
        print(f'Phase 3 seed {seed}: balanced policies and all 4 runtime parity cohorts verified', flush=True)
    if runtime_bundle is None:
        raise ValueError('Fixed runtime seed missing')
    # Compact portable inference artifacts contain no patients/claims/training rows.
    bundle_output = ROOT / 'backEnd/artifacts/xgboost-advisory-v1.json'
    bundle_output.parent.mkdir(exist_ok=True)
    sources = ['oracle/xgboostAssessment.js', 'oracle/observableFeatures.js', 'backEnd/research/context.js',
               'backEnd/services/continuousFeatureService.js', 'backEnd/research/phase3-plan.json']
    runtime_bundle['sourceSha256'] = {name: digest(ROOT / name) for name in sources}
    if bundle_output.exists():
        if read(bundle_output) != runtime_bundle:
            raise ValueError('Refusing to overwrite a different published advisory artifact; version and review a replacement explicitly')
    else:
        save(bundle_output, runtime_bundle)
    summary = {'reviewedOn': '2026-10-24', 'plan': plan, 'results': results,
               'bundle': str(bundle_output.relative_to(ROOT)).replace('\\', '/'), 'bundleSha256': digest(bundle_output),
               'scope': 'Exploratory balanced advisory evaluation; same constructed cohorts; no natural-fraud or hosted validation',
               'runtimeDecision': 'Default Admin advisory only; NB remains the protocol verification model'}
    save(output / 'summary.json', summary)
    print(str(output), flush=True)


if __name__ == '__main__':
    run()
