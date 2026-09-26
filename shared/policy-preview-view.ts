/** Frozen M1-B presentation seam. No policy rules or execution capabilities. */
import type { PolicyPreviewCaseSummary, PolicyPreviewResult } from './policy-preview.ts';

export interface PolicyPreviewViewState {
  caseId: string;
  budgetText: string;
  phase: 'idle' | 'loading' | 'ready' | 'error';
  result: PolicyPreviewResult | null;
  message: string;
}

export interface PolicyPreviewPanelProps {
  cases: readonly PolicyPreviewCaseSummary[];
  state: PolicyPreviewViewState;
  onCaseChange(caseId: string): void;
  onBudgetChange(budgetText: string): void;
  onAssess(): void;
}
