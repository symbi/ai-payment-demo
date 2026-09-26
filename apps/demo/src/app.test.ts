import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createDemoApp } from './app.ts';
import { assessDemoPayment, DEFAULT_WEIGHTS, type DemoAssessmentInput } from '../../../shared/demo-assessment.ts';

async function inject(app: Express, method: string, url: string, body?: unknown, headers: Record<string, string | undefined> = {}) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
  });
  const request = new IncomingMessage(socket as never);
  request.method = method;
  request.url = url;
  const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
  request.headers = encoded ? { 'content-type': 'application/json', 'content-length': String(encoded.length), host: '127.0.0.1' } : { host: '127.0.0.1' };
  request.headers = { ...request.headers, ...headers };
  const response = new ServerResponse(request);
  response.assignSocket(socket as never);
  const finished = new Promise<void>((resolve, reject) => { response.once('finish', resolve); response.once('error', reject); });
  app(request, response);
  if (encoded) request.push(encoded);
  request.push(null);
  await finished;
  const raw = Buffer.concat(chunks).toString('utf8');
  const [head, payload = ''] = raw.split('\r\n\r\n');
  return { status: Number(/^HTTP\/1\.1 (\d+)/m.exec(head)?.[1]), body: payload, headers: head };
}

const valid: DemoAssessmentInput = { fixtureId: 'controlled-a', amount: '0.001000', taskLimit: '0.005000', weights: [...DEFAULT_WEIGHTS], contentChanged: false };

describe('in-memory Express demo API (never listens)', () => {
  it('matches the pure assessment and states that payment is disabled', async () => {
    const response = await inject(createDemoApp({ html: '<!doctype html><title>demo</title>' }), 'POST', '/api/demo/assess', valid);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual(assessDemoPayment(valid));
    expect(JSON.parse(response.body)).toMatchObject({ simulation: true, paymentEnabled: false,
      execution: { signed: false, submitted: false, paid: false, reportPurchased: false } });
  });

  it.each([
    [{ ...valid, fixtureId: 'caller-invented', safe: true }],
    [{ ...valid, address: '0x1111111111111111111111111111111111111111' }],
    [{ ...valid, weights: [40, 25, 15, 10, 9] }],
  ])('fails closed for caller-controlled evidence or malformed input', async body => {
    const response = await inject(createDemoApp(), 'POST', '/api/demo/assess', body);
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ simulation: true, paymentEnabled: false, decision: 'invalid', contributions: [], errors: expect.any(Array) });
  });

  it('serves only the generated page and the one assessment route', async () => {
    const app = createDemoApp({ html: '<!doctype html><title>demo</title>' });
    expect((await inject(app, 'GET', '/')).status).toBe(200);
    expect((await inject(app, 'GET', '/package.json')).status).toBe(404);
    expect((await inject(app, 'POST', '/api/pay', {})).status).toBe(404);
  });
});

  it.each([{ origin: 'http://elsewhere.invalid' }, { host: 'rebind.invalid' }, { 'sec-fetch-site': 'cross-site' }])('rejects a non-local or cross-origin request', async headers => {
    const response = await inject(createDemoApp(), 'POST', '/api/demo/assess', valid, headers);
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).decision).toBe('invalid');
  });
  it('accepts the same-origin request and explains a changed content contribution', async () => {
    const response = await inject(createDemoApp(), 'POST', '/api/demo/assess', {...valid, contentChanged: true}, {origin: 'http://127.0.0.1'});
    expect(response.status).toBe(200);
    const result = JSON.parse(response.body);
    expect(result.decision).toBe('deny');
    expect(result.contributions[1]).toMatchObject({level: 1, note: '模拟付款内容已改变'});
  });
