"""Single GH-9 execution; portable copy of the existing pilot launch guard."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

BASE = '2320b665ffd95e8267e007c044462335c9f5ef6f'
READY = 'symphony-private-m0-ready-20260927'
DISABLED = 'symphony-private-m0-disabled'
ROOT = Path(__file__).resolve().parent


def check():
    if Path.cwd().resolve() != (ROOT / 'workspaces/GH-9').resolve():
        raise RuntimeError('Only the prepared GH-9 workspace may execute')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    if head != BASE:
        raise RuntimeError('Fixed baseCommit mismatch')
    subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--'], check=True)
    settings = json.loads((ROOT / 'model.local.json').read_text())
    if (settings.get('verifiedOnThisMachine') is not True or
            not isinstance(settings.get('model'), str) or not settings['model'].strip() or
            settings.get('reasoning') not in ('low', 'medium', 'high')):
        raise RuntimeError('A model verified on this private machine is required')
    return settings


def disarm():
    workflow = ROOT / 'WORKFLOW.md'
    workflow.write_text(workflow.read_text().replace('    - ' + READY, '    - ' + DISABLED))


def run():
    settings = check()
    state = ROOT / 'state'
    state.mkdir(exist_ok=True)
    # Never delete this marker to retry. A failed run requires coordinator diagnosis.
    fd = os.open(state / 'attempt-GH-9', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as marker:
        marker.write(str(time.time()))
    env = {k: v for k, v in os.environ.items() if k not in (
        'GITHUB_TOKEN', 'GH_TOKEN', 'INTERCEPTA_API_KEY', 'BUYER_PRIVATE_KEY',
        'OPENAI_API_KEY', 'CODEX_API_KEY', 'ENABLE_TESTNET_PAYMENTS')}
    args = ['codex', '-c', 'model=' + json.dumps(settings['model']),
            '-c', 'model_reasoning_effort=' + json.dumps(settings['reasoning']),
            '-c', 'features.multi_agent=false', 'app-server']
    child = subprocess.Popen(args, env=env, start_new_session=True)
    (state / 'process-GH-9.json').write_text(json.dumps({
        'pid': child.pid, 'started': time.time(), 'baseCommit': BASE,
        'model': settings['model'], 'reasoning': settings['reasoning'], 'limitSeconds': 1200}))

    def stop(*_):
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        rc = child.wait(timeout=1200)
    except subprocess.TimeoutExpired:
        stop()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        rc = 124
    (state / 'exit-GH-9.json').write_text(json.dumps({'exitCode': rc, 'finished': time.time()}))
    return rc


if __name__ == '__main__':
    if sys.argv[1:] == ['--check']:
        check()
    else:
        try:
            sys.exit(run())
        finally:
            disarm()
