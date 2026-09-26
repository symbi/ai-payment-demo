import express, { type ErrorRequestHandler } from 'express';
import type { BuyerConfig } from './config.ts';
import { BuyerService } from './service.ts';
import { InputError, inspectInput, payInput, requestId } from './input.ts';

export function createBuyerApp(config: BuyerConfig, service = new BuyerService(config)) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin && !['http://127.0.0.1:5178', 'http://localhost:5178', 'http://127.0.0.1:4031', 'http://localhost:4031'].includes(origin)) { res.status(403).json({ error: '只接受本机演示页面的请求' }); return; }
    const host = req.get('host');
    if (!host || !/^(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?$/.test(host) || req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: '请求来源不受支持' }); return; }
    if (req.method === 'POST' && !req.is('application/json')) { res.status(415).json({ error: '请求必须为 JSON' }); return; }
    next();
  });
  app.use(express.json({ limit: '4kb', strict: true }));
  app.get('/api/health', async (_req, res) => { res.json(await service.health()); });
  app.post('/api/inspect', async (req, res) => { const input = inspectInput(req.body); res.json(await service.inspect(input.requestId, input.prompt)); });
  app.post('/api/pay', async (req, res) => { res.json(await service.pay(payInput(req.body))); });
  app.get('/api/requests/:id', (req, res) => { res.json(service.get(requestId(req.params.id))); });
  app.use((_req, res) => { res.status(404).json({ error: '接口不存在' }); });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error instanceof InputError ? error.status : error?.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: error instanceof InputError ? error.message : status === 413 ? '请求过大' : status === 400 ? 'JSON 格式错误' : '服务处理失败；未自动重试，请检查请求状态' });
  };
  app.use(errors);
  return app;
}
