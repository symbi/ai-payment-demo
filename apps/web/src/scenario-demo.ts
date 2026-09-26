/** Local, fictional catalog. Prices and seller claims are demonstration data only. */
export type IconStyle = 'outline' | 'solid' | 'duotone';
export interface Brief { style: IconStyle; editable: boolean; commercial: boolean; budget: number }
export interface ExampleSeller { id: string; name: string; pack: string; style: IconStyle; format: 'SVG' | 'PNG'; commercialClaim: boolean; credits: number }
export const exampleSellers: readonly ExampleSeller[] = [
  { id: 'lucent', name: 'Lucent Studio', pack: 'Gather / 24 icons', style: 'outline', format: 'SVG', commercialClaim: true, credits: 3 },
  { id: 'open', name: 'Open Shapes', pack: 'Meet / 18 icons', style: 'solid', format: 'SVG', commercialClaim: true, credits: 0 },
  { id: 'prism', name: 'Prism Works', pack: 'Social / 32 icons', style: 'duotone', format: 'PNG', commercialClaim: true, credits: 1 },
];
export const defaultBrief: Brief = { style: 'outline', editable: true, commercial: true, budget: 3 };
export function assessSeller(seller: ExampleSeller, brief: Brief) {
  const checks = [
    { label: 'Style', matches: seller.style === brief.style, detail: seller.style === brief.style ? `${brief.style} style` : `Style is ${seller.style}` },
    { label: 'Format', matches: !brief.editable || seller.format === 'SVG', detail: !brief.editable ? 'Any format accepted' : seller.format === 'SVG' ? 'Editable SVG listed' : 'SVG not listed' },
    { label: 'License claim', matches: !brief.commercial || seller.commercialClaim, detail: !brief.commercial ? 'Commercial claim not required' : seller.commercialClaim ? 'Commercial use claimed · unverified' : 'Commercial use not stated' },
    { label: 'Budget', matches: seller.credits <= brief.budget, detail: seller.credits <= brief.budget ? 'Within demo budget' : 'Over demo budget' },
  ];
  return { checks, matches: checks.filter(c => c.matches).length, allMatch: checks.every(c => c.matches) };
}
export function recommendSeller(brief: Brief): ExampleSeller | undefined {
  // All requested conditions must match; price breaks ties, never payment status.
  return exampleSellers.filter(s => assessSeller(s, brief).allMatch).sort((a, b) => a.credits - b.credits || a.id.localeCompare(b.id))[0];
}
