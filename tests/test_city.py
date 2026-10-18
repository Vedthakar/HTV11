import unittest
from scripts.prepare_city import normalize

class CityPreparationTests(unittest.TestCase):
    def feature(self, height='12.5', x=-79.38):
        return {'type': 'Feature', 'properties': {'OBJECTID': 8, 'DERIVED_HEIGHT': height},
                'geometry': {'type': 'MultiPolygon', 'coordinates': [[[[x,43.65],[x+.001,43.65],[x+.001,43.651],[x,43.65]]]]}}

    def test_converts_height_and_keeps_unknown_condition(self):
        source = self.feature()
        result = normalize(source)
        self.assertEqual(result['id'], 8)
        self.assertEqual(result['properties']['height'], 12.5)
        self.assertEqual(result['properties']['condition'], 'unknown')
        self.assertEqual(source['properties']['DERIVED_HEIGHT'], '12.5')

    def test_invalid_heights_are_labelled_fallbacks(self):
        for height in [None, '', 'NaN', '-2', '900', '0']:
            with self.subTest(height=height):
                p = normalize(self.feature(height))['properties']
                self.assertEqual(p['height'], 6)
                self.assertEqual(p['heightSource'], 'display fallback')

    def test_outside_sample_excluded(self):
        self.assertIsNone(normalize(self.feature(x=-80)))

if __name__ == '__main__':
    unittest.main()
