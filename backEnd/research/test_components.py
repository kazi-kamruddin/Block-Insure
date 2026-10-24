import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
import unittest
import numpy as np
from components import (fit_hawkes, temporal_features, fit_calibration, calibrate,
                        conformal_quantile, prediction_sets, fit_ood, ood_distances,
                        select_threshold, probability_metrics, paired_bootstrap)


class CandidateTests(unittest.TestCase):
    def test_conformal_finite_sample_quantile(self):
        self.assertEqual(conformal_quantile(np.array([.1, .2, .8]), np.array([0, 0, 1]), .1), 1)
        sets = prediction_sets(np.array([.1, .5, .9]), .2)
        self.assertEqual(sets.tolist(), [[True, False], [False, False], [False, True]])

    def test_conformal_invalid_alpha(self):
        with self.assertRaises(ValueError):
            conformal_quantile(np.array([.5]), np.array([0]), 0)

    def test_calibration_is_monotone_and_finite(self):
        p = np.linspace(.01, .99, 100)
        c = fit_calibration(p, p > .6)
        values = calibrate(p, c)
        self.assertTrue(np.all(np.diff(values) >= 0))
        self.assertTrue(np.all(np.isfinite(values)))

    def test_calibration_rejects_single_class(self):
        with self.assertRaises(ValueError):
            fit_calibration(np.array([.1, .2]), [0, 0])

    def test_ood_singular_groups_and_fallback(self):
        x = np.ones((50, 3))
        a = fit_ood(x, ['A'] * 50, ['D'] * 50)
        values, sources = ood_distances(np.array([[1, 1, 1], [10, 1, 1]]), ['A', 'UNKNOWN'], ['D', ''], a)
        self.assertEqual(sources, ['diagnosis', 'pooled'])
        self.assertEqual(values[0], 0)
        self.assertGreater(values[1], 0)

    def test_ood_does_not_require_labels(self):
        a = fit_ood(np.arange(120).reshape(40, 3), ['A'] * 40, [''] * 40)
        self.assertNotIn('target', a)

    def test_budget_whole_ties_and_mandatory_overflow(self):
        point = select_threshold(np.array([.5, .5, .5]), np.array([1, 0, 0]), np.array([0, 0, 0]), .2)
        self.assertGreater(point['threshold'], 1)
        point = select_threshold(np.array([.1, .2, .3]), np.array([0, 0, 1]), np.array([1, 1, 0]), .1)
        self.assertAlmostEqual(point['effectiveBudget'], 2 / 3)

    def test_probability_metrics_ties(self):
        m = probability_metrics(np.array([.5, .5, .5, .5]), np.array([0, 1, 0, 1]))
        self.assertEqual(m['rocAuc'], .5)
        self.assertEqual(m['averagePrecision'], .5)
        self.assertEqual(m['brier'], .25)

    def test_hawkes_prior_only_input(self):
        a = {'available': True, 'mu': .1, 'alpha': .5, 'beta': .2}
        one = temporal_features([1, 2], a)
        self.assertGreater(one['temporal_hawkes_intensity'], temporal_features([], a)['temporal_hawkes_intensity'])
        for invalid in ([0], [-1], [91], [float('nan')]):
            with self.assertRaises(ValueError):
                temporal_features(invalid, a)

    def test_hawkes_fits_training_daily_sequence(self):
        a = fit_hawkes([list(range(0, 100, 2)), list(range(1, 100, 3))])
        self.assertTrue(a['available'])
        self.assertLess(a['alpha'], 1)
        self.assertTrue(np.isfinite(a['trainingLoss']))

    def test_bootstrap_pairing(self):
        y = np.array([0, 1, 0, 1], bool)
        a = paired_bootstrap(y, y, y, ['a', 'a', 'b', 'b'], 71, 50)
        self.assertEqual(a['percentile95'], [0, 0])


if __name__ == '__main__':
    unittest.main()
