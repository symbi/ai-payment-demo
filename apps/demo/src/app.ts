import express, { type Express } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assessDemoPayment, isDemoAssessmentInput, result } from '../../../shared/demo-assessment.ts';

const defaultHtmlPath = fileURLToPath(new URL('../../../docs/offline-pay.html', import.meta.url));

export function createDemoApp(options: { html?: string } = {}): Express {
  const app = express();
  app.disable('x-powered-by');
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

  app.use((_request, response) => {
    response.status(404).json({ simulation: true, paymentEnabled: false, error: 'Demo route not found' });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(400).json(result('invalid', null, '演示请求无效。', '检查输入后重新评估。', [], [error instanceof SyntaxError ? '无效 JSON。' : '演示请求失败。']));
  });
  return app;
}
