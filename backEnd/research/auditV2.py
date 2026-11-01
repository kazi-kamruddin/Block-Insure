"""Explicit post-hoc descriptive audit of a frozen study; never train or tune."""
import argparse
import json
from pathlib import Path
import numpy as np
from components import digest, save, conformal_quantile, paired_bootstrap
from robust_components import workload_matched_decisions
from run import sets_report
from runV2 import score_cohort


def read(file):
    return json.loads(Path(file).read_text())


def run(output):
    output = Path(output).resolve()
    plan = read(output / 'prospective-record.json')['plan']
    summary_hash = digest(output / 'study-summary.json')
    result = {'scope': 'Post-hoc descriptive same-predictor calibration and matched-allocation audit; not a prospective superiority test',
              'sourceSha256': digest(__file__), 'studySummarySha256': summary_hash, 'seeds': {}, 'noRetraining': True}
    for seed in plan['seeds']:
        calibration = read(output.parent / f'{seed}-conformal.json')
        fitted = score_cohort(calibration, seed, output, plan)
        marginal = conformal_quantile(fitted['probabilities']['gbdt_full'], fitted['y'], plan['conformalAlpha'])
        values = {}
        for cohort in plan['cohorts']:
            rows = read(output.parent / f'{seed}-{cohort}.json')
            scored = score_cohort(rows, seed, output, plan)
            candidate = workload_matched_decisions(scored['probabilities']['gbdt_full'], scored['rule'], [r['id'] for r in rows], .3)
            nb = workload_matched_decisions(scored['probabilities']['observable_nb'], scored['rule'], [r['id'] for r in rows], .3)
            values[cohort] = {'marginalSamePredictor': sets_report(scored['probabilities']['gbdt_full'], scored['y'], marginal),
                              'labelConditionalSamePredictor': scored['conformal'],
                              'matched30CostVsNB': paired_bootstrap(scored['y'], candidate, nb, [r['provider'] for r in rows], seed, plan['bootstrapReplicates'])}
        result['seeds'][str(seed)] = values
    if digest(output / 'study-summary.json') != summary_hash:
        raise ValueError('Frozen study changed during audit')
    result['meanCoverage'] = {cohort: {method: float(np.mean([result['seeds'][str(seed)][cohort][method]['coverage'] for seed in plan['seeds']])) for method in ('marginalSamePredictor', 'labelConditionalSamePredictor')} for cohort in plan['cohorts']}
    save(output / 'posthoc-calibration-audit.json', result)
    print(json.dumps(result['meanCoverage'], indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('study')
    run(parser.parse_args().study)
