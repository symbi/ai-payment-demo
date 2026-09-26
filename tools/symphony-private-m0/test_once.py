"""Offline guard checks. Never launches Codex or accesses any network."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('private_once', Path(__file__).with_name('once.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
SETTINGS = {'model': 'verified-fixture-model', 'reasoning': 'medium', 'verifiedOnThisMachine': True}


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.root_patch = patch.object(guard, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def check_with(self, settings=SETTINGS, head=guard.BASE, cwd=None):
        (self.root / 'model.local.json').write_text(json.dumps(settings))
        with patch.object(Path, 'cwd', return_value=cwd or self.root / 'workspaces/GH-9'), \
                patch.object(subprocess, 'check_output', return_value=head), \
                patch.object(subprocess, 'run'):
            return guard.check()

    def test_checked_model_and_base(self):
        self.assertEqual(self.check_with(), SETTINGS)

    def test_wrong_workspace(self):
        with self.assertRaises(RuntimeError):
            self.check_with(cwd=self.root / 'workspaces/GH-8')

    def test_wrong_base(self):
        with self.assertRaises(RuntimeError):
            self.check_with(head='other')

    def test_unverified_model(self):
        with self.assertRaises(RuntimeError):
            self.check_with(settings={**SETTINGS, 'verifiedOnThisMachine': False})

    def test_disarm_preserves_cleanup_label(self):
        workflow = self.root / 'WORKFLOW.md'
        workflow.write_text('    - ' + guard.READY + '\nremove-label ' + guard.READY)
        guard.disarm()
        self.assertIn('    - ' + guard.DISABLED, workflow.read_text())
        self.assertIn('remove-label ' + guard.READY, workflow.read_text())

    def test_one_execution_and_secret_stripping(self):
        child = Mock(pid=1234, wait=Mock(return_value=0))
        with patch.object(guard, 'check', return_value=SETTINGS), \
                patch.object(subprocess, 'Popen', return_value=child) as popen, \
                patch.object(guard.signal, 'signal'), \
                patch.dict(guard.os.environ, {'INTERCEPTA_API_KEY': 'fixture-only', 'OPENAI_API_KEY': 'fixture-only'}):
            self.assertEqual(guard.run(), 0)
            with self.assertRaises(FileExistsError):
                guard.run()
            self.assertEqual(popen.call_count, 1)
            self.assertNotIn('INTERCEPTA_API_KEY', popen.call_args.kwargs['env'])
            self.assertNotIn('OPENAI_API_KEY', popen.call_args.kwargs['env'])

    def test_timeout_stops_process_group(self):
        child = Mock(pid=1234)
        child.wait.side_effect = [subprocess.TimeoutExpired('fake', 1200), 0]
        with patch.object(guard, 'check', return_value=SETTINGS), \
                patch.object(subprocess, 'Popen', return_value=child), \
                patch.object(guard.signal, 'signal'), patch.object(guard.os, 'killpg') as kill:
            self.assertEqual(guard.run(), 124)
            kill.assert_called_once_with(1234, guard.signal.SIGTERM)


if __name__ == '__main__':
    unittest.main()
