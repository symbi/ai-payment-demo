import express from 'express';
import { createSampleReports, INSIGHTS_PATH, SAMPLE_PATH } from './contract-insights.ts';
import { isAddress, zeroAddress } from 'viem';
import { paymentMiddlewareFromHTTPServer, x402ResourceServer, x402HTTPResourceServer } from '@x402/express';
import { HTTPFacilitatorClient, type FacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequirements, PaymentRequired } from '@x402/core/types';
import { CONTRACT_VERSION, TEST_NETWORK, TEST_USDC, PRICE_ATOMIC, type WeatherData } from '../../../shared/contracts.ts';

export interface SellerOptions {
  payTo?: string;
  facilitatorUrl?: string;
  /** Dependency injection for isolated SDK tests; the executable never supplies a test double. */
  facilitator?: FacilitatorClient;
}

export function createSellerApp(options: SellerOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  const { preview, report } = createSampleReports();
  const resources = [INSIGHTS_PATH, '/api/weather'];
  const payTo = options.payTo?.trim();
  const configured = !!payTo && isAddress(payTo) && payTo.toLowerCase() !== zeroAddress;
  let facilitatorStatus: 'not_checked' | 'ready' | 'unavailable' = 'not_checked';
  let facilitatorInitialized = false;
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_req, res) => {
    res.json({ service: 'seller', status: 'ok', contractVersion: CONTRACT_VERSION,
      configured, ready: configured && facilitatorInitialized && facilitatorStatus === 'ready', facilitatorStatus,
      facilitatorInitialized, readinessBasis: 'last_observed_facilitator_call',
      network: TEST_NETWORK, dataSource: 'bundled-solidity-sample',
      resourcePath: INSIGHTS_PATH, sourceSha256: preview.source.sha256,
      reason: configured ? undefined : 'SELLER_PAY_TO missing or invalid' });
  });
  app.get(SAMPLE_PATH, (_req, res) => { res.json(preview); });
  if (!configured) {
    app.get(resources, (_req, res) => {
      res.status(503).json({ error: 'seller_not_configured', reason: 'SELLER_PAY_TO missing or invalid' });
    });
    return app;
  }

  const facilitator = options.facilitator ?? new HTTPFacilitatorClient({
    url: options.facilitatorUrl ?? 'https://x402.org/facilitator', timeoutMs: 10_000,
  });
  // Observe actual completed calls, not reuse of a cached initialization promise.
  // An invalid payment response still proves reachability; a thrown transport error does not.
  async function observe<T>(call: () => Promise<T>): Promise<T> {
    try {
      const result = await call();
      facilitatorStatus = 'ready';
      return result;
    } catch (error) {
      facilitatorStatus = 'unavailable';
      throw error;
    }
  }
  const observedFacilitator: FacilitatorClient = {
    getSupported: () => observe(() => facilitator.getSupported()),
    verify: (payload, requirements) => observe(() => facilitator.verify(payload, requirements)),
    settle: (payload, requirements) => observe(() => facilitator.settle(payload, requirements)),
  };
  const server = new x402ResourceServer(observedFacilitator).register(TEST_NETWORK, new ExactEvmScheme());
  const terms: PaymentRequirements = { scheme: 'exact', network: TEST_NETWORK, payTo: payTo!,
    asset: TEST_USDC, amount: PRICE_ATOMIC, maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } };
  const description = 'Contract Insights: bundled Solidity sample declaration report; not a security audit';
  const httpServer = new x402HTTPResourceServer(server, Object.fromEntries(resources.map(path => [
    `GET ${path}`, {
      accepts: { scheme: 'exact', network: TEST_NETWORK, payTo: payTo!, maxTimeoutSeconds: 300,
        price: { asset: TEST_USDC, amount: PRICE_ATOMIC, extra: { name: 'USDC', version: '2' } } },
      description: path === INSIGHTS_PATH ? description : 'Legacy fixed weather demo fixture', mimeType: 'application/json',
    },
  ])));
  // Initialize lazily so /health and a missing configuration never require network access.
  let initialization: Promise<void> | undefined;
  // Use the same Express route matcher as the resource handler (including case/trailing slash).
  app.get(resources, async (req, res, next) => {
    try {
      initialization ??= httpServer.initialize();
      await initialization;
      facilitatorInitialized = true;
      next();
    } catch {
      initialization = undefined;
      facilitatorInitialized = false;
      facilitatorStatus = 'unavailable';
      if (!req.get('payment-signature') && !req.get('x-payment')) {
        // These are the merchant's configured terms, not proof the facilitator is available.
        const quote: PaymentRequired = { x402Version: 2, accepts: [terms],
          resource: { url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
            description: req.path.toLowerCase().startsWith(INSIGHTS_PATH) ? description : 'Legacy fixed weather demo fixture', mimeType: 'application/json' } };
        res.setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(quote));
        res.status(402).json({ ...quote, facilitatorStatus, notice: 'Configured quote only; facilitator initialization failed. Payment is unavailable.' });
        return;
      }
      res.status(503).json({ error: 'facilitator_unavailable' });
    }
  });
  app.use(paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false));
  app.get(resources, (req, res) => {
    if (req.path.toLowerCase().replace(/\/$/, '') === INSIGHTS_PATH) { res.json(report); return; }
    const data: WeatherData = { source: 'demo-fixture', city: 'Tokyo', weather: 'sunny',
      temperatureC: 24, notice: 'Fixed example data for the payment demo; not real-time weather.' };
    // The SDK buffers this body and releases it only after successful settlement.
    res.json(data);
  });
  return app;
}
