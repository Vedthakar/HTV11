import unittest
from scripts.prepare_evaluations import latest_records, number, contains

class EvaluationTests(unittest.TestCase):
    def test_latest_per_rsn_not_highest_score(self):
        rows=[{'RSN':'a','_id':'1','EVALUATION COMPLETED ON':'2023-01-01','score':'99'},
              {'RSN':'a','_id':'2','EVALUATION COMPLETED ON':'2025-01-01','score':'60'},
              {'RSN':'b','_id':'3','EVALUATION COMPLETED ON':'2024-01-01'}]
        result=latest_records(rows)
        self.assertEqual(len(result),2)
        self.assertEqual(result[0]['score'],'60')

    def test_invalid_scores_not_zero(self):
        for value in ['',None,'N/A','NaN','101','-1']:
            self.assertIsNone(number(value,0,100))
        self.assertEqual(number('0',0,100),0)

    def test_footprint_holes_not_matches(self):
        geometry={'coordinates':[[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]]}
        self.assertTrue(contains((.5,.5),geometry))
        self.assertFalse(contains((2,2),geometry))
        self.assertFalse(contains((5,5),geometry))
