import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
import xgboost as xgb
from components import digest, fit_ood, save
from infer import assess


class InferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='blockinsure-candidate-test-')
        self.directory = Path(self.temp.name)
        self.names = ['log_bill', 'temporal_hawkes_intensity', 'ood_distance']
        x = np.array([[0, .1, 0], [1, .2, 1], [2, .3, 2], [3, .4, 3]] * 10, dtype=np.float32)
        model = xgb.train({'objective': 'binary:logistic', 'base_score': .5, 'nthread': 1, 'max_depth': 2},
                          xgb.DMatrix(x, label=[0, 0, 1, 1] * 10, feature_names=self.names, nthread=1), num_boost_round=3)
        model.save_model(self.directory / 'model.xgb.json')
        artifact = {'schemaVersion': 'advanced-candidate-v1', 'authority': 'OFFLINE_ONLY', 'features': self.names,
                    'hawkes': {'available': True, 'mu': .1, 'alpha': .2, 'beta': .1},
                    'ood': {'features': ['log_bill'], 'parameters': fit_ood(x[:, :1], ['A'] * 40, [''] * 40), 'threshold': 4},
                    'calibration': {'slope': 1, 'intercept': 0}, 'conformal': {'quantile': .8}, 'policy': {'threshold': .8},
                    'modelSha256': digest(self.directory / 'model.xgb.json')}
        save(self.directory / 'pipeline.json', artifact)
        save(self.directory / 'receipt.json', {'pipelineSha256': digest(self.directory / 'pipeline.json')})
        self.observation = {'features': {'log_bill': 1}, 'providerLags': [1, 3], 'mandatory': False, 'group': 'A', 'diagnosis': ''}

    def tearDown(self):
        self.temp.cleanup()

    def test_packaged_prediction_explains_and_does_not_transact(self):
        result = assess(self.directory, self.observation)
        self.assertIn('riskScore', result)
        self.assertEqual(result['explanation']['scale'], 'raw_margin')
        self.assertFalse(result['transactionCreated'])

    def test_answer_key_and_scenario_do_not_change_assessment(self):
        before = assess(self.directory, self.observation)
        after = assess(self.directory, {**self.observation, 'target': True, 'fraudLabel': 'FRAUD', 'scenario': 'ATTACK'})
        self.assertEqual(before, after)

    def test_mandatory_rules_cannot_be_bypassed(self):
        result = assess(self.directory, {**self.observation, 'mandatory': True})
        self.assertEqual(result['recommendation'], 'MANUAL_REVIEW')
        self.assertIn('INTEGRITY_FINDING', result['reasons'])

    def test_missing_context_and_nonfinite_inputs_fail_closed(self):
        for change in ({'features': {}}, {'features': {'log_bill': float('nan')}}, {'providerLags': [0]}, {'mandatory': 'false'}):
            result = assess(self.directory, {**self.observation, **change})
            self.assertEqual(result['reason'], 'INPUT_UNAVAILABLE_OR_INVALID')
            self.assertEqual(result['recommendation'], 'MANUAL_REVIEW')

    def test_unfamiliar_large_value_warns(self):
        result = assess(self.directory, {**self.observation, 'features': {'log_bill': 1000}, 'group': 'UNKNOWN'})
        self.assertTrue(result['ood']['warning'])
        self.assertEqual(result['ood']['groupSource'], 'pooled')

    def test_modified_model_is_rejected(self):
        with (self.directory / 'model.xgb.json').open('a') as stream:
            stream.write(' ')
        with self.assertRaisesRegex(ValueError, 'Model identity'):
            assess(self.directory, self.observation)

    def test_modified_pipeline_is_rejected(self):
        with (self.directory / 'pipeline.json').open('a') as stream:
            stream.write(' ')
        with self.assertRaisesRegex(ValueError, 'Pipeline identity'):
            assess(self.directory, self.observation)


if __name__ == '__main__':
    unittest.main()
