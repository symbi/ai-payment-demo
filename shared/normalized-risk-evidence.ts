type Provenance =
  | { readonly origin: 'LIVE'; readonly provider: 'intercepta' }
  | { readonly origin: 'SYNTHETIC'; readonly provider: 'synthetic' };

/** Decision evidence only; provenance never grants execution authority. */
export type NormalizedRiskEvidence = Provenance & (
  | {
      readonly available: false;
      readonly toxicScore?: never;
      readonly traits: readonly [];
      readonly traitsCount: null;
      readonly unknownTraitsCount: null;
      readonly complete: false;
    }
  | {
      readonly available: true;
      readonly toxicScore: number;
      readonly traits: readonly string[];
      readonly traitsCount: number;
      readonly unknownTraitsCount: number | null;
      readonly complete: boolean;
    }
);
