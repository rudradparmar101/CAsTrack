'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/format';
import { fyLabel, fyStartYear } from '@/lib/compliance/period';
import { GST_STATES, gstStateName, stateCodeFromGstin } from '@/lib/gst-states';
import { createDraftInvoiceAction } from './actions';
import type { Client, FeeMaster } from '@/lib/types';

interface LineItem {
  key: string;
  description: string;
  sac_code: string;
  quantity: number;
  rate: number;
  gst_rate: number;
}

function emptyItem(): LineItem {
  return { key: crypto.randomUUID(), description: '', sac_code: '9982', quantity: 1, rate: 0, gst_rate: 18 };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface InvoiceFormProps {
  clients: Pick<Client, 'id' | 'name' | 'gstin'>[];
  feeMasters: Pick<FeeMaster, 'id' | 'client_id' | 'service_name' | 'amount' | 'compliance_type_id'>[];
  firmGstin: string | null;
  /** Client's own state, for defaulting place of supply (recon Group D) —
   *  keyed by client id, sourced from an active GSTIN registration falling
   *  back to the registered address. Always a pre-fill, never locks the
   *  place-of-supply field. */
  clientDefaultStates: Record<string, { state: string | null; state_code: string | null }>;
  onSuccess: (invoiceId: string) => void;
  onCancel: () => void;
}

export function InvoiceForm({
  clients,
  feeMasters,
  firmGstin,
  clientDefaultStates,
  onSuccess,
  onCancel,
}: InvoiceFormProps) {
  const [clientId, setClientId] = useState('');
  const [financialYear, setFinancialYear] = useState(() => fyLabel(fyStartYear(new Date())));
  const [dueDate, setDueDate] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [placeOfSupplyStateCode, setPlaceOfSupplyStateCode] = useState('');
  const [isInterstate, setIsInterstate] = useState(false);
  const [tdsExpected, setTdsExpected] = useState(0);
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedClient = clients.find((c) => c.id === clientId) || null;
  const feeOptionsForClient = useMemo(
    () => feeMasters.filter((fm) => fm.client_id === clientId || fm.client_id === null),
    [feeMasters, clientId]
  );

  const firmStateCode = useMemo(() => stateCodeFromGstin(firmGstin), [firmGstin]);

  // is_interstate is re-derived fresh every time the place of supply (or the
  // firm's own state) changes — deliberately NOT sticky across invoices or
  // across a place-of-supply edit within one invoice. Only fires when both
  // codes are known (a firm GSTIN is on file AND a place of supply is set);
  // otherwise the checkbox is left exactly as the user last set it by hand.
  const deriveInterstate = (nextPlaceOfSupplyCode: string) => {
    if (firmStateCode && nextPlaceOfSupplyCode) {
      setIsInterstate(firmStateCode !== nextPlaceOfSupplyCode);
    }
  };

  // Default place of supply from the selected client's own state — still a
  // plain editable field afterward, never locked (recon Group D: nothing
  // wired this before; the client's state was sitting unused in
  // client_registrations/client_addresses).
  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    const def = clientDefaultStates[newClientId];
    if (!def?.state_code) return;
    setPlaceOfSupplyStateCode(def.state_code);
    setPlaceOfSupply(gstStateName(def.state_code) ?? def.state ?? '');
    deriveInterstate(def.state_code);
  };

  const handlePlaceOfSupplySelect = (code: string) => {
    setPlaceOfSupplyStateCode(code);
    setPlaceOfSupply(gstStateName(code) ?? '');
    deriveInterstate(code);
  };

  const handleStateCodeInput = (code: string) => {
    setPlaceOfSupplyStateCode(code);
    deriveInterstate(code);
  };

  const interstateHint = useMemo(() => {
    if (!firmStateCode) return "Set your firm's GSTIN in Settings to auto-detect interstate supply.";
    if (!placeOfSupplyStateCode) return 'Choose a place of supply to auto-detect interstate supply.';
    const firmName = gstStateName(firmStateCode) ?? firmStateCode;
    const supplyName = gstStateName(placeOfSupplyStateCode) ?? placeOfSupplyStateCode;
    const relation = firmStateCode === placeOfSupplyStateCode ? '=' : '≠';
    return `Auto-set from place of supply — ${supplyName} ${relation} your state (${firmName}). Override below if needed.`;
  }, [firmStateCode, placeOfSupplyStateCode]);

  // Mirrors issue_firm_invoice()'s computation exactly (schema.sql) so this
  // preview matches what actually gets stored on issue — same per-item
  // rounding, same CGST/SGST/IGST split, same whole-rupee round-off. This
  // does NOT change how tax is computed; the DB function remains the only
  // place that writes the real numbers.
  const { subtotal, cgstAmount, sgstAmount, igstAmount, roundOff, totalAmount } = useMemo(() => {
    const itemTaxableValues = items.map((i) => round2(i.quantity * i.rate));
    const subtotalCalc = round2(itemTaxableValues.reduce((sum, v) => sum + v, 0));
    const gstPerItem = items.map((i, idx) => round2((itemTaxableValues[idx] * i.gst_rate) / 100));
    const gstTotalCalc = round2(gstPerItem.reduce((sum, v) => sum + v, 0));
    const cgst = isInterstate ? 0 : round2(gstTotalCalc / 2);
    const sgst = isInterstate ? 0 : round2(gstTotalCalc - cgst);
    const igst = isInterstate ? gstTotalCalc : 0;
    const rawTotal = subtotalCalc + gstTotalCalc;
    const total = Math.round(rawTotal);
    return {
      subtotal: subtotalCalc,
      cgstAmount: cgst,
      sgstAmount: sgst,
      igstAmount: igst,
      gstTotal: gstTotalCalc,
      roundOff: round2(total - rawTotal),
      totalAmount: total,
    };
  }, [items, isInterstate]);

  const updateItem = (key: string, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  };

  const applyFeeMaster = (key: string, feeMasterId: string) => {
    const fee = feeMasters.find((f) => f.id === feeMasterId);
    if (!fee) return;
    updateItem(key, { description: fee.service_name, rate: fee.amount });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await createDraftInvoiceAction({
      client_id: clientId,
      financial_year: financialYear,
      due_date: dueDate || null,
      firm_gstin: firmGstin,
      client_gstin: selectedClient?.gstin || null,
      place_of_supply: placeOfSupply || null,
      place_of_supply_state_code: placeOfSupplyStateCode || null,
      is_interstate: isInterstate,
      tds_expected: tdsExpected,
      items: items.map((i) => ({
        description: i.description,
        sac_code: i.sac_code,
        quantity: i.quantity,
        rate: i.rate,
        gst_rate: i.gst_rate,
      })),
    });

    if (result.success && result.data) {
      onSuccess(result.data.id);
    } else {
      setError(result.error || 'Something went wrong');
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select
        label="Client"
        options={[{ value: '', label: 'Select a client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
        value={clientId}
        onChange={(e) => handleClientChange(e.target.value)}
        required
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Financial Year"
          value={financialYear}
          onChange={(e) => setFinancialYear(e.target.value)}
          placeholder="2026-27"
          required
        />
        <Input label="Due Date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Place of Supply"
          placeholder="Select a state"
          options={GST_STATES.map((s) => ({ value: s.code, label: s.name }))}
          value={GST_STATES.some((s) => s.code === placeOfSupplyStateCode) ? placeOfSupplyStateCode : ''}
          onChange={(e) => handlePlaceOfSupplySelect(e.target.value)}
        />
        <Input
          label="State Code"
          value={placeOfSupplyStateCode}
          onChange={(e) => handleStateCodeInput(e.target.value)}
          placeholder="e.g. 24"
          maxLength={2}
          hint="Auto-fills from the state above — hand-edit for SEZ/edge cases."
        />
      </div>

      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
          <input type="checkbox" checked={isInterstate} onChange={(e) => setIsInterstate(e.target.checked)} />
          Interstate supply (IGST instead of CGST+SGST)
        </label>
        <p className="text-xs text-[var(--color-text-muted)] pl-6">{interstateHint}</p>
      </div>

      <Input
        label="Expected TDS (u/s 194J)"
        type="number"
        min={0}
        step="0.01"
        value={tdsExpected}
        onChange={(e) => setTdsExpected(Number(e.target.value) || 0)}
        hint="Display-only estimate; actual settlement uses TDS recorded on receipts."
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Line Items</h3>
          <Button type="button" size="sm" variant="secondary" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
            <Plus className="h-3.5 w-3.5" />
            Add item
          </Button>
        </div>

        {items.map((item) => (
          <div key={item.key} className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
            <div className="flex gap-2">
              {feeOptionsForClient.length > 0 && (
                <select
                  className="text-xs rounded-lg border border-[var(--color-border)] px-2 py-1.5 bg-[var(--color-surface)] text-[var(--color-text)]"
                  onChange={(e) => e.target.value && applyFeeMaster(item.key, e.target.value)}
                  value=""
                >
                  <option value="">Fill from rate card…</option>
                  {feeOptionsForClient.map((fm) => (
                    <option key={fm.id} value={fm.id}>
                      {fm.service_name} ({formatINR(fm.amount)})
                    </option>
                  ))}
                </select>
              )}
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                  className="ml-auto p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                  aria-label="Remove line item"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Input
              label="Description"
              value={item.description}
              onChange={(e) => updateItem(item.key, { description: e.target.value })}
              required
            />
            <div className="grid grid-cols-4 gap-2">
              <Input
                label="SAC/HSN"
                value={item.sac_code}
                onChange={(e) => updateItem(item.key, { sac_code: e.target.value })}
                placeholder="9982"
              />
              <Input
                label="Qty"
                type="number"
                min={0.01}
                step="0.01"
                value={item.quantity}
                onChange={(e) => updateItem(item.key, { quantity: Number(e.target.value) || 0 })}
              />
              <Input
                label="Rate (₹)"
                type="number"
                min={0}
                step="0.01"
                value={item.rate}
                onChange={(e) => updateItem(item.key, { rate: Number(e.target.value) || 0 })}
              />
              <Input
                label="GST %"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={item.gst_rate}
                onChange={(e) => updateItem(item.key, { gst_rate: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-[var(--color-muted)] px-4 py-3 text-sm text-[var(--color-text-secondary)] space-y-1">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatINR(subtotal)}</span>
        </div>
        {isInterstate ? (
          <div className="flex justify-between">
            <span>IGST</span>
            <span>{formatINR(igstAmount)}</span>
          </div>
        ) : (
          <>
            <div className="flex justify-between">
              <span>CGST</span>
              <span>{formatINR(cgstAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span>SGST</span>
              <span>{formatINR(sgstAmount)}</span>
            </div>
          </>
        )}
        {roundOff !== 0 && (
          <div className="flex justify-between">
            <span>Round off</span>
            <span>{formatINR(roundOff)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-[var(--color-text)] pt-1 border-t border-[var(--color-border)]">
          <span>Total</span>
          <span>{formatINR(totalAmount)}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end pt-4 sticky bottom-0 -mx-6 px-6 pb-2 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          Save Draft
        </Button>
      </div>
    </form>
  );
}
