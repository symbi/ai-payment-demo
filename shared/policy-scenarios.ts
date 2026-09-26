/** Static synthetic inputs only; policy results are computed by the consumer. */
export type PolicyScenario = Readonly<{
  id: string;
  title: string;
  amountUsdc: string;
  input: Readonly<{
    synthetic: true;
    toxicScore: number;
    traitsCount: number;
    traitLabels: readonly string[];
    unknownTraitsCount: number;
  }>;
}>;

export const POLICY_SCENARIOS: readonly PolicyScenario[] = Object.freeze([
  Object.freeze({
    id: 'synthetic-mixer-50', title: 'Mixer transfer', amountUsdc: '0.0005',
    input: Object.freeze({
      synthetic: true, toxicScore: 50, traitsCount: 1,
      traitLabels: Object.freeze(['mixer_transfers']), unknownTraitsCount: 0,
    }),
  }),
  Object.freeze({
    id: 'synthetic-sanction-50', title: 'Sanction address', amountUsdc: '0.0005',
    input: Object.freeze({
      synthetic: true, toxicScore: 50, traitsCount: 1,
      traitLabels: Object.freeze(['sanction_address']), unknownTraitsCount: 0,
    }),
  }),
  Object.freeze({
    id: 'synthetic-unknown-50', title: 'Unknown trait', amountUsdc: '0.0005',
    input: Object.freeze({
      synthetic: true, toxicScore: 50, traitsCount: 1,
      traitLabels: Object.freeze([]), unknownTraitsCount: 1,
    }),
  }),
]);
