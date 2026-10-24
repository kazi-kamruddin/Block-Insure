"""Source-grounded engineering study; frozen stress-cohort scoring, never promotion."""
import os
for variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[variable] = '1'
import argparse
import json
import time
from pathlib import Path
import numpy as np
from scipy.special import expit
import xgboost as xgb
from components import (digest, save, calibrate, conformal_quantile, prediction_sets,
                        confusion, probability_metrics, paired_bootstrap)
from robust_components import fit_normalized_hawkes, workload_matched_decisions
from run import evaluate, ROOT, PARTS, nb_predict, logistic_predict, sets_report
from infer import prepare


def read(path):
    return json.loads(Path(path).read_text())


def score_cohort(rows, seed, output, plan):
    directory = output / str(seed)
    artifact = read(directory / 'pipeline.json')
    prepared = [prepare(artifact, row) for row in rows]
    matrix = np.concatenate([value[0] for value in prepared])
    model = xgb.Booster(params={'nthread': 1})
    model.load_model(directory / 'model.xgb.json'); model.set_param({'nthread': 1})
    raw = expit(model.predict(xgb.DMatrix(matrix, feature_names=artifact['features'], nthread=1), output_margin=True).astype(float))
    p = calibrate(raw, artifact['calibration'])
    sets = prediction_sets(p, artifact['conformal']['quantile'])
    y = np.asarray([r['target'] for r in rows], bool)
    rule = np.asarray([r['mandatory'] for r in rows], bool)
    ood = np.asarray([value[1][0] > artifact['ood']['threshold'] for value in prepared])
    decisions = {'rules_only': rule, 'gbdt_full': rule | ood | ~(sets[:, 0] & ~sets[:, 1]) | (p >= artifact['policy']['threshold'])}
    probabilities = {'gbdt_full': p}
    for name in ('observable_nb', 'binary_lr', 'continuous_lr'):
        baseline = read(output / f'{seed}-{name}.json')
        x = np.array([[r['features'][feature] for feature in baseline['features']] for r in rows], dtype=np.float32)
        bp = nb_predict(baseline['model'], x) if name == 'observable_nb' else logistic_predict(baseline['model'], x)
        bp = calibrate(bp, baseline['calibration'])
        probabilities[name] = bp
        decisions[name] = rule | (bp >= baseline['policy']['threshold'])
    base = read(directory / 'base-pipeline.json')
    base_model = xgb.Booster(params={'nthread': 1}); base_model.load_model(directory / 'base-model.xgb.json'); base_model.set_param({'nthread': 1})
    bx = np.array([[r['features'][feature] for feature in base['features']] for r in rows], dtype=np.float32)
    bp = calibrate(expit(base_model.predict(xgb.DMatrix(bx, feature_names=base['features'], nthread=1), output_margin=True).astype(float)), base['calibration'])
    probabilities['gbdt_base'] = bp
    decisions['gbdt_base'] = rule | (bp >= base['policy']['threshold'])
    return {'methods': {name: {'routing': confusion(y, decision), **({'probability': probability_metrics(probabilities[name], y)} if name in probabilities else {})} for name, decision in decisions.items()},
            'conformal': sets_report(p, y, artifact['conformal']['quantile']), 'oodWarningRate': float(ood.mean()),
            'y': y, 'decisions': decisions, 'probabilities': probabilities,
            'rawProbability': raw, 'rule': rule}


def run(directory):
    directory = Path(directory).resolve()
    if directory.parent != (ROOT / 'docs/engineered').resolve() or not directory.name.startswith('advanced-'):
        raise ValueError('Use ignored advanced-* engineered directory')
    manifest = read(directory / 'input-manifest.json')
    if manifest['schema'] != 'source-grounded-actions-v2':
        raise ValueError('Expected reconstructed action benchmark v2')
    def check():
        for name, expected in manifest['files'].items():
            if digest(directory / name) != expected:
                raise ValueError('Prepared data changed')
        for name, expected in manifest['sourceFiles'].items():
            if digest(ROOT / name) != expected:
                raise ValueError('Engineering source changed; regenerate into a new directory')
    check()
    plan = read(directory / 'plan.json')
    source = {p.name: digest(p) for p in Path(__file__).parent.iterdir() if p.suffix in ('.py', '.js', '.json', '.txt')}
    output = directory / ('study-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
    output.mkdir()
    save(output / 'prospective-record.json', {'sourceSha256': source, 'plan': plan, 'inputManifestSha256': digest(directory / 'input-manifest.json'),
         'scope': 'Post-v1, prospective-before-new-training exploratory engineering; never independent confirmation',
         'recordedBeforeTraining': True, 'threads': 1, 'versions': {'numpy': np.__version__, 'xgboost': xgb.__version__}})
    hawkes = fit_normalized_hawkes(read(directory / 'training-series.json'))
    save(output / 'hawkes.json', hawkes)
    primary, challenges = [], {}
    for seed in plan['seeds']:
        evaluation = evaluate(seed, directory, output, plan, hawkes)
        primary.append(evaluation)
        challenge = {}
        # Each cohort uses the SAME fitted predictor, calibration and policy.
        train_providers = {row['provider'] for row in read(directory / f'{seed}-train.json')}
        train_patients = {row['patient'] for row in read(directory / f'{seed}-train.json')}
        for cohort in ('test', 'test_prevalence', 'test_severity', 'test_family'):
            print(f'Seed {seed}: frozen stress scoring {cohort}', flush=True)
            rows = read(directory / f'{seed}-{cohort}.json')
            if any(r['provider'] in train_providers or r['patient'] in train_patients for r in rows):
                raise ValueError('Stress cohort overlaps training entities')
            scored = score_cohort(rows, seed, output, plan)
            y, decision = scored['y'], scored['decisions']['gbdt_full']
            if np.any(scored['rule'] & ~decision):
                raise ValueError('Stress routing bypassed integrity rules')
            families = {}
            for family in sorted({r['scenario'] for r in rows}):
                mask = np.asarray([r['scenario'] == family for r in rows])
                families[family] = {'rows': int(mask.sum()), 'intentional': int(y[mask].sum()), 'routed': int(decision[mask].sum())}
            matched = {}
            for budget in (.2, .3, .5):
                matched[str(budget)] = {name: confusion(y, workload_matched_decisions(prob, scored['rule'], [r['id'] for r in rows], budget)) for name, prob in scored['probabilities'].items()}
            challenge[cohort] = {'records': len(rows), 'attackRate': float(y.mean()), 'methods': scored['methods'],
                                  'conformal': scored['conformal'], 'oodWarningRate': scored['oodWarningRate'], 'families': families,
                                  'workloadMatchedRankingDiagnostic': matched,
                                  'allocationNote': 'Label-blind finite-cohort ranking at equal requested count; hash-ID tie breaks. Mandatory findings retained, but extra CP/OOD gates intentionally omitted. Not a replacement runtime routing result.',
                                  'pairedCostVsNB': paired_bootstrap(y, decision, scored['decisions']['observable_nb'], [r['provider'] for r in rows], seed, plan['bootstrapReplicates'])}
        pairs = read(directory / f'{seed}-intent-pairs.json')
        scored = score_cohort(pairs, seed, output, plan)
        differences = [abs(scored['probabilities']['gbdt_full'][i] - scored['probabilities']['gbdt_full'][i + 1]) for i in range(0, len(pairs), 2)]
        if max(differences) > 1e-12:
            raise ValueError('Intent-only twins acquired leaked predictive information')
        challenge['intentTwins'] = {'pairs': len(pairs) // 2, 'maxScoreDifference': float(max(differences)),
                                    'meaning': 'Known simulated opposite intents with identical observable context cannot be distinguished. No perfect fraud claim is possible.',
                                    'routing': scored['methods']['gbdt_full']['routing']}
        save(output / f'{seed}-challenge-evaluation.json', challenge)
        challenges[str(seed)] = challenge
    check()
    for name, expected in source.items():
        if digest(Path(__file__).with_name(name)) != expected:
            raise ValueError('Candidate source changed during study')
    ids = [row['id'] for seed in plan['seeds'] for row in read(directory / f'{seed}-test.json')]
    summary = {'reviewedAtUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'scope': plan['scope'], 'promotion': 'HOLD', 'seeds': plan['seeds'],
               'testRows': {'primaryEvaluations': len(ids), 'allCohortEvaluations': len(ids) * 4, 'uniqueSourceClaims': len(set(ids)), 'note': 'Stress cohorts reuse anchors; scenario/sampling seeds overlap; not independent observations'},
               'reason': 'Post-result engineered benchmark and unobserved intent cannot establish natural-fraud benefit or authorize runtime integration.',
               'meanRouting': {name: {key: float(np.mean([r['methods'][name]['routing'][key] for r in primary])) for key in ('recall', 'f1', 'reviewRate', 'cost')} for name in primary[0]['methods']},
               'cohorts': {cohort: {'meanCoverage': float(np.mean([challenges[str(seed)][cohort]['conformal']['coverage'] for seed in plan['seeds']])),
                                   'meanReviewRate': float(np.mean([challenges[str(seed)][cohort]['methods']['gbdt_full']['routing']['reviewRate'] for seed in plan['seeds']]))} for cohort in ('test', 'test_prevalence', 'test_severity', 'test_family')},
               'sourceCount': manifest['rawCount'], 'pairDiagnostics': manifest['pairDiagnostics'], 'temporalFit': hawkes,
               'limitations': ['Constructed action truth, not adjudicated fraud', 'Benign controls are simulator assumptions; raw controls are not certified legitimate', 'Pure-prior-shift CP protection does not cover provider or family/conditional shift', 'Intent-only twins intentionally expose irreducible ambiguity', 'No real bank graph, service-necessity labels or intraday timestamps', 'Workload-matched ranking is separate from full safeguarded routing', 'Same benchmark/source partitions, three scenario/sampling seeds; not independent source replications', 'No Phase 3 runtime context commitments or activation']}
    save(output / 'study-summary.json', summary)
    print(json.dumps({'output': str(output), 'promotion': summary['promotion'], 'meanRouting': summary['meanRouting'], 'cohorts': summary['cohorts']}, indent=2), flush=True)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('directory')
    run(parser.parse_args().directory)
