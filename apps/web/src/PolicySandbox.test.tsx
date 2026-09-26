import { isDeepStrictEqual } from 'node:util';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as policy from '../../../shared/live-payment-policy.ts';
import { POLICY_SCENARIOS } from '../../../shared/policy-scenarios.ts';
import { PolicySandbox } from './PolicySandbox.tsx';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = () => renderToStaticMarkup(createElement(PolicySandbox));
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const titles = ['Mixer transfer', 'Sanction address', 'Unknown trait'] as const;

// Locate each title's following visible content without requiring a particular
// card tag/class or test-only selector. All three must be in the same render.
function cards(html: string) {
  const positions = titles.map(title => {
    // Exact text nodes distinguish the title "Unknown trait" from an input
    // label such as "Unknown traits count" without imposing heading markup.
    const matches = [...html.matchAll(new RegExp(`>\\s*${title}\\s*<`, 'g'))];
    expect(matches, `${title} must be visible exactly once`).toHaveLength(1);
    return matches[0]!.index! + 1;
  });
  return titles.map((_title, index) => {
    const start = positions[index]!;
    const next = positions.filter(position => position > start).sort((a, b) => a - b)[0];
    return text(html.slice(start, next ?? html.length));
  });
}

function expectResult(card: string, result: policy.LivePaymentPolicyResult) {
  expect(card).toContain(result.decision);
  expect(card).toContain(result.reasonCode);
  if (result.capUsdc !== null) expect(card).toContain(result.capUsdc);
  else expect(card).toMatch(/(?:cap|limit)\s*[:：]?\s*(?:null|none|—|–|not applicable|n\/a)/i);
  const within = result.amountWithinLimit ? '(?:true|yes)' : '(?:false|no)';
  expect(card).toMatch(new RegExp(`(?:amountWithinLimit|amount within limit|within cap|within limit)\\s*[:：]?\\s*${within}\\b`, 'i'));
}

describe('independent Policy Sandbox presentation', () => {
  it('prominently identifies synthetic provenance and disconnected execution', () => {
    const visible = text(render());
    expect(visible).toContain('Decision Lab · SIMULATED');
    expect(visible).toContain('SIMULATED');
    expect(visible).toContain('Same score. Different evidence. Different action.');
    expect(visible).toContain('the raw score is display-only');
    expect(visible).toContain('Synthetic policy scenario');
    expect(visible).toContain('Not a live Intercepta response');
    expect(visible).toContain('Payment execution — NOT CONNECTED');
  });

  it('shows the three equal-score inputs and their distinct computed full policy outcomes', () => {
    const renderedCards = cards(render());
    const oracles: policy.LivePaymentPolicyResult[] = [
      { policyRevision: 'project-intercepta-payment-policy-v1', policyName: 'Project/Intercepta Payment Policy v1', decision: 'ALLOW_WITH_LIMIT', reasonCode: 'moderate_trait', capUsdc: '0.001', amountWithinLimit: true, execution: 'NOT_CONNECTED' },
      { policyRevision: 'project-intercepta-payment-policy-v1', policyName: 'Project/Intercepta Payment Policy v1', decision: 'DENY', reasonCode: 'hard_deny_trait', capUsdc: null, amountWithinLimit: false, execution: 'NOT_CONNECTED' },
      { policyRevision: 'project-intercepta-payment-policy-v1', policyName: 'Project/Intercepta Payment Policy v1', decision: 'HOLD', reasonCode: 'unknown_traits', capUsdc: null, amountWithinLimit: false, execution: 'NOT_CONNECTED' },
    ];
    for (const [index, card] of renderedCards.entries()) {
      expect(card).toMatch(/\b50\b/);
      expect(card).toContain('0.0005');
      expect(card).toContain('USDC');
      expect(card).toContain('Decision Factors');
      expect(card).toContain('Evidence Quality');
      expect(card).toContain('Raw provider signal — not used as a threshold by this policy');
      expect(card).toContain(index === 2 ? 'Unknown — reported trait is not identified' : 'Complete synthetic labels supplied');
      expect(card).toContain(`Displayed labels ${index === 2 ? 0 : 1}`);
      expect(card).toMatch(new RegExp(`unknown(?: traits?)?(?: count)?\\s*[:：]?\\s*${index === 2 ? 1 : 0}\\b`, 'i'));
      expectResult(card, oracles[index]!);
    }
    expect(renderedCards[0]).toContain('mixer_transfers');
    expect(renderedCards[1]).toContain('sanction_address');
    expect(renderedCards[2]).not.toContain('mixer_transfers');
    expect(renderedCards[2]).not.toContain('sanction_address');
  });

  it('keeps synthetic display identities attached to scenario ids when display order changes', async () => {
    const reversed = [...POLICY_SCENARIOS].reverse();
    vi.resetModules();
    vi.doMock('../../../shared/policy-scenarios.ts', () => ({ POLICY_SCENARIOS: reversed }));
    try {
      const { PolicySandbox: ReorderedLab } = await import('./PolicySandbox.tsx');
      const html = renderToStaticMarkup(createElement(ReorderedLab));
      const visibleCards = cards(html);
      ['SIM-001', 'SIM-002', 'SIM-003'].forEach((id, index) => {
        expect(visibleCards[index]).toContain(`Synthetic Recipient ID: ${id}`);
      });
      expect(text(html)).toContain('SIMULATED');
      expect(html).not.toContain('0x');
    } finally {
      vi.doUnmock('../../../shared/policy-scenarios.ts');
      vi.resetModules();
    }
  });

  it('evaluates every fixture during each render and displays adapter results, not saved JSX decisions', () => {
    expect(POLICY_SCENARIOS).toHaveLength(3);
    const outputs: policy.LivePaymentPolicyResult[] = [
      { policyRevision: 'project-intercepta-payment-policy-v1', policyName: 'Project/Intercepta Payment Policy v1', decision: 'ALLOW', reasonCode: 'no_traits', capUsdc: null, amountWithinLimit: true, execution: 'NOT_CONNECTED' },
      { policyRevision: 'project-intercepta-payment-policy-v1', policyName: 'Project/Intercepta Payment Policy v1', decision: 'ALLOW_WITH_LIMIT', reasonCode: 'moderate_trait', capUsdc: '0.001', amountWithinLimit: false, execution: 'NOT_CONNECTED' },
      { policyRevision: 'project-intercepta-payment-policy-v1', policyName: 'Project/Intercepta Payment Policy v1', decision: 'HOLD', reasonCode: 'invalid_amount', capUsdc: null, amountWithinLimit: false, execution: 'NOT_CONNECTED' },
    ];
    const adapter = vi.spyOn(policy, 'evaluateSyntheticPaymentPolicy').mockImplementation(input => {
      const index = POLICY_SCENARIOS.findIndex(scenario => isDeepStrictEqual(scenario.input, input));
      expect(index, 'render must evaluate one of the exact input-only fixtures').toBeGreaterThanOrEqual(0);
      return outputs[index]!;
    });
    for (let pass = 0; pass < 2; pass += 1) {
      adapter.mockClear();
      const renderedCards = cards(render());
      expect(adapter).toHaveBeenCalledTimes(3);
      POLICY_SCENARIOS.forEach((scenario, index) => {
        expect(adapter).toHaveBeenCalledWith(scenario.input, scenario.amountUsdc);
        expectResult(renderedCards[index]!, outputs[index]!);
      });
    }
  });

  it('has no scan, API, persistence, address, receipt or execution surface', () => {
    const fetch = vi.fn(() => { throw new Error('sandbox must not request data'); });
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    const html = render();
    expect(text(html)).toContain('Payment execution — NOT CONNECTED');
    expect(html).not.toMatch(/<(?:button|input|select|textarea|form|a|iframe)\b/i);
    expect(html).not.toMatch(/\b0x[a-fA-F0-9]{40}\b/);
    expect(html).not.toMatch(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text(html)).not.toMatch(/HTTP\s*200|source\s*:\s*live|provider\s*:\s*intercepta|live[- ](?:source|response)\s*badge/i);
    expect(text(html)).not.toMatch(/connect wallet|pay now|download|receipt|scan now|assess address|used requests|remaining quota/i);
    expect(fetch).not.toHaveBeenCalled();
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
  });
});
