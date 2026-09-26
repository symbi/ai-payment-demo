import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_PACKAGES = ['express', 'react', 'esbuild', 'tsx'];

const defaultResolve = (name, root) => {
  const require = createRequire(join(root, 'package.json'));
  require.resolve(name);
};

function publicAddress(value) {
  return typeof value === 'string'
    && /^0x[0-9a-fA-F]{40}$/.test(value)
    && !/^0x0{40}$/i.test(value);
}

export function checkDemo({
  root = process.cwd(),
  env = process.env,
  resolve = defaultResolve,
  nodeVersion = process.versions.node,
} = {}) {
  const [major, minor] = nodeVersion.split('.').map(Number);
  const node = Number.isInteger(major) && Number.isInteger(minor) && major >= 22 && major < 27 && (major !== 22 || minor >= 12);
  const dependencies = REQUIRED_PACKAGES.every(name => {
    try {
      resolve(name, root);
      return true;
    } catch {
      return false;
    }
  });
  const page = existsSync(join(root, 'docs', 'private-risk.html'));
  const budgetText = env.PRIVATE_RISK_MAX_REQUESTS ?? '3';
  const requestBudget = /^[1-9][0-9]{0,3}$/.test(budgetText) && Number(budgetText) <= 1000;
  const environment = requestBudget && env.PRIVATE_RISK_MACHINE === 'personal'
    && env.PRIVATE_RISK_FREE_QUOTA_CONFIRMED === 'true'
    && env.PRIVATE_RISK_PRIOR_REQUESTS === '0';
  const apiKey = typeof env.INTERCEPTA_API_KEY === 'string'
    && env.INTERCEPTA_API_KEY.trim().length > 0 && !/[\r\n]/.test(env.INTERCEPTA_API_KEY.trim());
  const budgetAddresses = publicAddress(env.BUYER_ADDRESS)
    && publicAddress(env.SELLER_PAY_TO);
  const passed = node && dependencies && page && environment && apiKey;

  return {
    passed,
    node,
    dependencies,
    page,
    environment,
    apiKey,
    budgetAddresses,
    meaning: 'local-preparation-only',
  };
}

export function formatCli(result) {
  const fields = [
    `node=${result.node ? 'ok' : 'blocked'}`,
    `dependencies=${result.dependencies ? 'ok' : 'blocked'}`,
    `page=${result.page ? 'ok' : 'blocked'}`,
    `environment=${result.environment ? 'ready' : 'blocked'}`,
    `api_key=${result.apiKey ? 'present' : 'absent'}`,
    `budget_addresses=${result.budgetAddresses ? 'ready' : 'pending'}`,
    `local_check=${result.passed ? 'pass' : 'fail'}`,
    `meaning=${result.meaning}`,
  ];
  return fields.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) {
  const result = checkDemo();
  console.log(formatCli(result));
  process.exitCode = result.passed ? 0 : 1;
}
