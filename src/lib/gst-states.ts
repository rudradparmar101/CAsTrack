/**
 * Standard Indian GST state/UT code list (statutory, fixed — first two
 * digits of any GSTIN). Plain constants module, same convention as
 * lib/ca-options.ts (importable from both server and client code).
 *
 * Used to: (a) turn the invoice form's place-of-supply into a dropdown
 * instead of free text, (b) derive a firm's own state from its GSTIN so
 * is_interstate can be suggested rather than typed blind. This is display/
 * UX plumbing only — it does not change how tax is computed (that stays in
 * issue_firm_invoice(), untouched).
 */

export interface GstState {
  code: string;
  name: string;
}

export const GST_STATES: GstState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '25', name: 'Daman and Diu' },
  { code: '26', name: 'Dadra and Nagar Haveli' },
  { code: '27', name: 'Maharashtra' },
  { code: '28', name: 'Andhra Pradesh (Old)' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh (New)' },
  { code: '97', name: 'Other Territory' },
];

export function gstStateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return GST_STATES.find((s) => s.code === code)?.name ?? null;
}

export function gstStateCodeByName(name: string | null | undefined): string | null {
  if (!name) return null;
  return GST_STATES.find((s) => s.name === name)?.code ?? null;
}

/** First 2 digits of a GSTIN are its state code. Returns null for anything
 *  too short to have one (e.g. firm GSTIN not yet set). */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  return gstin.slice(0, 2);
}
