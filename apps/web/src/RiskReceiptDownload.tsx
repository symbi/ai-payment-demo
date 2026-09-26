import { buildRiskReceipt } from '../../../shared/risk-receipt.ts';

export type RiskReceiptDownloadProps = Readonly<{
  status: unknown;
  candidateId: unknown;
}>;

export function RiskReceiptDownload({ status, candidateId }: RiskReceiptDownloadProps) {
  const receipt = buildRiskReceipt(status, candidateId);

  const download = () => {
    const current = buildRiskReceipt(status, candidateId);
    if (!current) return;

    const objectUrl = URL.createObjectURL(new Blob([
      `${JSON.stringify(current, null, 2)}\n`,
    ], { type: 'application/json' }));
    const anchor = document.createElement('a');
    try {
      anchor.href = objectUrl;
      anchor.download = `risk-receipt-${current.candidateId}.json`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  };

  return <button type="button" disabled={!receipt} onClick={download}>下载本次评估摘要</button>;
}
