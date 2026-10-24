"""Score a prepared observable claim/context, not a trusted runtime message."""
import os
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['OPENBLAS_NUM_THREADS'] = '1'
import argparse
import json
from pathlib import Path
import numpy as np
import xgboost as xgb
from scipy.special import expit
from components import digest, temporal_features, ood_distances, calibrate, prediction_sets


def prepare(artifact, observation):
    if type(observation['mandatory']) is not bool:
        raise ValueError('Explicit mandatory integrity result required')
    features = {**observation['features'], **temporal_features(observation['providerLags'], artifact['hawkes'])}
    # Match training's float32 observation contract BEFORE OOD standardization.
    ood_values = np.asarray([[features[name] for name in artifact['ood']['features']]], dtype=np.float32)
    if not np.isfinite(ood_values).all():
        raise ValueError('Nonfinite OOD inputs')
    distance, source = ood_distances(ood_values, [observation['group']], [observation.get('diagnosis', '')], artifact['ood']['parameters'])
    features['ood_distance'] = float(distance[0])
    row = np.asarray([[features[name] for name in artifact['features']]], dtype=np.float32)
    if not np.isfinite(row).all():
        raise ValueError('Nonfinite feature')
    return row, distance, source


def assess(directory, observation):
    directory = Path(directory)
    artifact = json.loads((directory / 'pipeline.json').read_text())
    if artifact['schemaVersion'] not in ('advanced-candidate-v1', 'advanced-candidate-v2') or artifact['authority'] != 'OFFLINE_ONLY':
        raise ValueError('Unsupported pipeline')
    if digest(directory / 'model.xgb.json') != artifact['modelSha256']:
        raise ValueError('Model identity mismatch')
    receipt = json.loads((directory / 'receipt.json').read_text())
    if receipt['pipelineSha256'] != digest(directory / 'pipeline.json'):
        raise ValueError('Pipeline identity mismatch')
    try:
        row, distance, source = prepare(artifact, observation)
    except (KeyError, TypeError, ValueError) as error:
        return {'authority': 'OFFLINE_ONLY', 'recommendation': 'MANUAL_REVIEW', 'reason': 'INPUT_UNAVAILABLE_OR_INVALID', 'detail': str(error), 'transactionCreated': False}
    booster = xgb.Booster(params={'nthread': 1})
    booster.load_model(directory / 'model.xgb.json')
    booster.set_param({'nthread': 1})
    matrix = xgb.DMatrix(row, feature_names=artifact['features'], nthread=1)
    raw = expit(booster.predict(matrix, output_margin=True).astype(float)) if artifact.get('probabilityContract') == 'float64_sigmoid_of_float32_margin' else booster.predict(matrix)
    probability = float(calibrate(raw, artifact['calibration'])[0])
    values = prediction_sets(np.array([probability]), artifact['conformal']['quantile'])[0]
    unknown = not (values[0] and not values[1])
    ood = bool(distance[0] > artifact['ood']['threshold'])
    reasons = [name for name, active in [('INTEGRITY_FINDING', observation['mandatory']), ('OOD_WARNING', ood), ('CONFORMAL_NOT_CONTROL_SINGLETON', unknown), ('MODEL_THRESHOLD', probability >= artifact['policy']['threshold'])] if active]
    shap = booster.predict(matrix, pred_contribs=True, approx_contribs=False)[0]
    return {'authority': 'OFFLINE_ONLY', 'recommendation': 'MANUAL_REVIEW' if reasons else 'AUTO_VERIFICATION_ELIGIBLE_SUBJECT_TO_PROTOCOL',
            'reasons': reasons, 'riskScore': probability, 'riskMeaning': 'Constructed attack task score, not real-world fraud probability',
            'predictionSet': [label for label, included in zip(['UNMUTATED_CONTROL', 'CONTROLLED_ATTACK'], values) if included],
            'ood': {'distance': float(distance[0]), 'warning': ood, 'groupSource': source[0]},
            'explanation': {'scale': 'raw_margin', 'base': float(shap[-1]), 'contributions': {name: float(value) for name, value in zip(artifact['features'], shap[:-1])}},
            'pipelineSha256': receipt['pipelineSha256'], 'modelSha256': artifact['modelSha256'], 'transactionCreated': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('artifact_directory')
    parser.add_argument('observation_json')
    args = parser.parse_args()
    print(json.dumps(assess(args.artifact_directory, json.loads(Path(args.observation_json).read_text())), indent=2, allow_nan=False))
