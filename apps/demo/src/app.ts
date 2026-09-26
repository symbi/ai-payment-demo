import express, { type Express } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assessDemoPayment, isDemoAssessmentInput, result } from '../../../shared/demo-assessment.ts';

import { DemoRequestStore, isDemoRequestInput, isRequestId, RequestError } from '../../../shared/demo-requests.ts';

const defaultHtmlPath = fileURLToPath(new URL('../../../docs/offline-pay.html', import.meta.url));

export function createDemoApp(options: { html?: string; requests?: DemoRequestStore } = {}): Express {
  const app = express();
  const requests = options.requests ?? new DemoRequestStore();
  app.disable('x-powered-by');
  app.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  app.use((request, response, next) => {
    const host = request.get('host') ?? '';
    const origin = request.get('origin');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
      || (origin !== undefined && origin !== `http://${host}`)
      || request.get('sec-fetch-site') === 'cross-site') {
      response.status(403).json(result('invalid', null, '只接受本机同源演示请求。', '从本机演示页面重新评估。', [], ['请求来源无效。']));
      return;
    }
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));

  app.get('/', (_request, response) => {
    const html = options.html ?? readFileSync(defaultHtmlPath, 'utf8');
    response.type('html').set('Cache-Control', 'no-store').send(html);
  });

  app.post('/api/demo/assess', (request, response) => {
    if (!isDemoAssessmentInput(request.body)) {
      response.status(400).json(result('invalid', null, '输入无效，未执行任何动作。', '检查输入和权重合计后重新评估。', [], ['只接受预置样例、金额、额度、合计 100 的五项权重和内容变化值。']));
      return;
    }
    const assessment = assessDemoPayment(request.body);
    response.status(assessment.decision === 'invalid' ? 400 : 200).json(assessment);
  });

  app.post('/api/demo/requests', (request, response) => {
    const body = request.body as { id?: unknown; input?: unknown } | null;
    if (!body || !isRequestId(body.id) || !isDemoRequestInput(body.input)
      || Object.keys(body).some(key => !['id', 'input'].includes(key))) {
      response.status(400).json({ simulation: true, paymentEnabled: false, error: '模拟请求输入无效。' }); return;
    }
    try { response.json(requests.post(body.id, body.input)); }
    catch (error) {
      if (!(error instanceof RequestError)) throw error;
      response.status(error.code === 'conflict' ? 409 : error.code === 'capacity' ? 503 : 400)
        .json({ simulation: true, paymentEnabled: false, code: error.code, error: error.message });
    }
  });
  app.get('/api/demo/requests/:id', (request, response) => {
    if (!isRequestId(request.params.id)) { response.status(400).json({ simulation: true, paymentEnabled: false, error: '无效请求编号。' }); return; }
    const record = requests.get(request.params.id);
    if (!record) { response.status(404).json({ simulation: true, paymentEnabled: false, status: 'unresolved', error: '原模拟记录不存在；不会自动新建请求。' }); return; }
    response.json(record);
  });

  app.use((_request, response) => {
    response.status(404).json({ simulation: true, paymentEnabled: false, error: 'Demo route not found' });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(400).json(result('invalid', null, '演示请求无效。', '检查输入后重新评估。', [], [error instanceof SyntaxError ? '无效 JSON。' : '演示请求失败。']));
  });
  return app;
}
