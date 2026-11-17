import importlib.util
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location('release_base', Path(__file__).with_name('select-release-base.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def release(tag, draft=False, prerelease=False):
    return {'tag_name': tag, 'draft': draft, 'prerelease': prerelease}


class ReleaseBaseTests(unittest.TestCase):
    def test_first_fork_release_has_no_base(self):
        self.assertEqual(module.select_release_base('v0.24.0', [], True), '')

    def test_first_stable_after_prerelease_has_no_base(self):
        releases = [release('v0.24.0-rc.1', prerelease=True), release('v0.24.0', draft=True)]
        self.assertEqual(module.select_release_base('v0.24.0', releases, True), '')

    def test_default_still_requires_a_stable_base(self):
        with self.assertRaises(ValueError):
            module.select_release_base('v0.24.0', [])

    def test_uses_highest_earlier_stable_release(self):
        releases = [release('v0.22.0'), release('v0.23.0'), release('v0.25.0'),
                    release('v0.23.1', draft=True), release('v0.24.0-rc.1', prerelease=True)]
        self.assertEqual(module.select_release_base('v0.24.0', releases, True), 'v0.23.0')

    def test_newer_stable_release_is_not_a_first_release(self):
        with self.assertRaises(ValueError):
            module.select_release_base('v0.24.0', [release('v0.25.0')], True)

    def test_invalid_tag_is_rejected_on_first_release(self):
        with self.assertRaises(ValueError):
            module.select_release_base('invalid', [], True)


if __name__ == '__main__':
    unittest.main()
