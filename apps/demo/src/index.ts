import { createDemoApp } from './app.ts';

const requestedPort = Number(process.argv[2] ?? '47912');
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
  throw new Error('Demo port must be an integer from 1024 to 65535.');
}

createDemoApp().listen(requestedPort, '127.0.0.1', () => {
  console.log(`Pay simulation demo: http://127.0.0.1:${requestedPort}`);
});
