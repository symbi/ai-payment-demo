import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const root = new URL('../', import.meta.url);
const env = new URL('.env', root);
const vault = new URL('.runtime/', root);
const secretPath = new URL('demo-merchant.key', vault);
if (existsSync(env) || existsSync(secretPath)) {
  console.error('Local configuration already exists; nothing overwritten.');
  process.exitCode = 1;
} else {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  mkdirSync(vault, { recursive: true, mode: 0o700 });
  // Isolated empty merchant wallet; NEVER fund with real money. No buyer signer configured.
  writeFileSync(secretPath, key + '\n', { flag: 'wx', mode: 0o600 });
  const template = readFileSync(new URL('.env.example', root), 'utf8');
  writeFileSync(env, template.replace(/^SELLER_PAY_TO=$/m, `SELLER_PAY_TO=${account.address}`), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({
    merchantAddress: account.address,
    envPath: fileURLToPath(env),
    paymentsEnabled: false,
    note: 'New empty test merchant address, generated locally. No API key, buyer key, payment or network request.'
  }, null, 2));
}
