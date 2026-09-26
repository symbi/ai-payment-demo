import { buildPaymentDecisionReceipt } from '../../../shared/payment-decision-receipt.ts';

export type PaymentDecisionReceiptDownloadProps = Readonly<{
  status: unknown;
  candidateId: unknown;
  amountUsdc: string;
  loading: boolean;
}>;

export function PaymentDecisionReceiptDownload(
  { status, candidateId, amountUsdc, loading }: PaymentDecisionReceiptDownloadProps,
) {
  const available = !loading && !!buildPaymentDecisionReceipt(
    status,
    candidateId,
    amountUsdc,
    new Date().toISOString(),
  );

  const download = () => {
    if (loading) return;

    const current = buildPaymentDecisionReceipt(
      status,
      candidateId,
      amountUsdc,
      new Date().toISOString(),
    );
    if (!current) return;

    const objectUrl = URL.createObjectURL(new Blob([
      `${JSON.stringify(current, null, 2)}\n`,
    ], { type: 'application/json' }));
    const anchor = document.createElement('a');
    try {
      anchor.href = objectUrl;
      anchor.download = `project-decision-${current.intent.candidateId}.json`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  };

  return <>
    <p>Original scan receipt (v2) is separate. This snapshot contains the current project rules and amount. Execution NOT CONNECTED.</p>
    <button type="button" disabled={!available} onClick={download}>Download project decision snapshot</button>
  </>;
}
