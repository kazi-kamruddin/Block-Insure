import unittest
import numpy as np
from components import conformal_quantile, prediction_sets
from robust_components import fit_normalized_hawkes, workload_matched_decisions


class RobustTests(unittest.TestCase):
    def test_class_conditional_tracks_each_class(self):
        p = np.r_[np.linspace(.01, .4, 400), np.linspace(.3, .99, 40)]
        y = np.r_[np.zeros(400, int), np.ones(40, int)]
        q = conformal_quantile(p, y, .1, method='label_conditional')
        self.assertEqual(q['counts'], {'0': 400, '1': 40})
        self.assertNotEqual(q['0'], q['1'])

    def test_sparse_class_abstains_instead_of_faking_calibration(self):
        q = conformal_quantile(np.array([.1, .2, .9]), np.array([0, 0, 1]), .1, method='label_conditional')
        self.assertEqual(q['0'], 1)
        self.assertEqual(q['1'], 1)
        self.assertEqual(prediction_sets(np.array([.1, .9]), q).tolist(), [[True, True], [True, True]])

    def test_prior_shift_simulation_not_nominal_universal_guarantee(self):
        rng = np.random.default_rng(101)
        p0, p1 = rng.beta(2, 8, 4000), rng.beta(4, 3, 400)
        q = conformal_quantile(np.r_[p0, p1], np.r_[np.zeros(len(p0)), np.ones(len(p1))], .1, method='label_conditional')
        shifted = np.r_[rng.beta(2, 8, 1000), rng.beta(4, 3, 5000)]
        labels = np.r_[np.zeros(1000, int), np.ones(5000, int)]
        sets = prediction_sets(shifted, q)
        for label in (0, 1):
            self.assertGreater(sets[labels == label, label].mean(), .85)

    def test_workload_matching_is_exact_and_label_free(self):
        p, m = np.array([.1, .8, .8, .2]), np.array([True, False, False, False])
        decision = workload_matched_decisions(p, m, ['d', 'b', 'a', 'c'], .5)
        self.assertEqual(decision.tolist(), [True, False, True, False])
        self.assertEqual(workload_matched_decisions(p, m, ['d', 'b', 'a', 'c'], 0).sum(), 1)

    def test_temporal_fit_selects_against_provider_baseline(self):
        artifact = fit_normalized_hawkes([list(range(0, 200, 2)), list(range(0, 200, 10))])
        self.assertEqual(artifact['mode'], 'provider_normalized_daily')
        self.assertLess(artifact['trainingCutoffDay'], artifact['days'])
        self.assertGreaterEqual(artifact['alpha'], 0)
        self.assertLessEqual(artifact['alpha'], .95)
        self.assertEqual(artifact['candidates'][0]['selection'], 'Poisson reference')


if __name__ == '__main__':
    unittest.main()
