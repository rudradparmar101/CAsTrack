'use client';

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { BUSINESS_TYPE_OPTIONS, ADDRESS_TYPE_OPTIONS } from '@/lib/ca-options';
import type {
  ActionResult,
  Client,
  ClientAddress,
  ClientAuthorizedPerson,
} from '@/lib/types';

interface AddressRow {
  key: string;
  type: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  state_code: string;
  pincode: string;
}

interface PersonRow {
  key: string;
  name: string;
  designation: string;
  pan: string;
  din: string;
  email: string;
  phone: string;
  is_primary: boolean;
}

interface ClientFormProps {
  client?: Client;
  /** Existing rows — pass from the detail page when editing. The update action
   *  uses replace-all semantics, so edit MUST supply the full current set. */
  addresses?: ClientAddress[];
  authorizedPersons?: ClientAuthorizedPerson[];
  action: (formData: FormData) => Promise<ActionResult>;
  onSuccess: () => void;
  onCancel: () => void;
}

function newAddressRow(): AddressRow {
  return {
    key: crypto.randomUUID(),
    type: 'registered',
    line1: '',
    line2: '',
    city: '',
    state: '',
    state_code: '',
    pincode: '',
  };
}

function newPersonRow(): PersonRow {
  return {
    key: crypto.randomUUID(),
    name: '',
    designation: '',
    pan: '',
    din: '',
    email: '',
    phone: '',
    is_primary: false,
  };
}

export function ClientForm({
  client,
  addresses: initialAddresses,
  authorizedPersons: initialPersons,
  action,
  onSuccess,
  onCancel,
}: ClientFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [addresses, setAddresses] = useState<AddressRow[]>(() =>
    (initialAddresses || []).map((a) => ({
      key: a.id,
      type: a.type,
      line1: a.line1,
      line2: a.line2 || '',
      city: a.city,
      state: a.state,
      state_code: a.state_code || '',
      pincode: a.pincode || '',
    }))
  );

  const [persons, setPersons] = useState<PersonRow[]>(() =>
    (initialPersons || []).map((p) => ({
      key: p.id,
      name: p.name,
      designation: p.designation || '',
      pan: p.pan || '',
      din: p.din || '',
      email: p.email || '',
      phone: p.phone || '',
      is_primary: p.is_primary,
    }))
  );

  const updateAddress = (key: string, patch: Partial<AddressRow>) => {
    setAddresses((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const updatePerson = (key: string, patch: Partial<PersonRow>) => {
    setPersons((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    if (client) formData.set('id', client.id);

    // Repeatable sub-forms travel as JSON — the action validates each row.
    // The local `key` field is UI-only state and stripped before submit.
    formData.set(
      'addresses',
      JSON.stringify(
        addresses.map((row) => {
          const { key, ...rest } = row;
          void key;
          return rest;
        })
      )
    );
    formData.set(
      'authorized_persons',
      JSON.stringify(
        persons.map((row) => {
          const { key, ...rest } = row;
          void key;
          return rest;
        })
      )
    );

    const result = await action(formData);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Something went wrong');
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-6">
        {/* ── Basic details ── */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Legal Name"
              name="name"
              placeholder="e.g., Mehta Textiles Pvt Ltd"
              defaultValue={client?.name}
              required
            />
            <Input
              label="Trade Name"
              name="trade_name"
              placeholder="e.g., Mehta Fabrics"
              defaultValue={client?.trade_name || ''}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Business Type"
              name="business_type"
              options={BUSINESS_TYPE_OPTIONS}
              defaultValue={client?.business_type || 'individual'}
              required
            />
            <Input
              label="Email"
              name="email"
              type="email"
              placeholder="accounts@client.com"
              defaultValue={client?.email || ''}
            />
          </div>
          <Input
            label="Phone"
            name="phone"
            placeholder="+91 98765 43210"
            defaultValue={client?.phone || ''}
          />
        </div>

        {/* ── Registration & compliance identifiers ── */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] border-b border-[var(--color-border)] pb-2">
            Registration Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="GSTIN"
              name="gstin"
              placeholder="27ABCDE1234F1Z5"
              defaultValue={client?.gstin || ''}
              className="uppercase"
              maxLength={15}
            />
            <Input
              label="PAN"
              name="pan"
              placeholder="ABCDE1234F"
              defaultValue={client?.pan || ''}
              className="uppercase"
              maxLength={10}
            />
            <Input
              label="TAN"
              name="tan"
              placeholder="MUMA12345B"
              defaultValue={client?.tan || ''}
              className="uppercase"
              maxLength={10}
            />
            <Input
              label="CIN"
              name="cin"
              placeholder="U12345MH2020PTC123456"
              defaultValue={client?.cin || ''}
              className="uppercase"
              maxLength={21}
            />
            <Input
              label="Incorporation Date"
              name="incorporation_date"
              type="date"
              defaultValue={client?.incorporation_date || ''}
            />
            <Input
              label="GST Registration Date"
              name="gst_registration_date"
              type="date"
              defaultValue={client?.gst_registration_date || ''}
            />
          </div>
        </div>

        {/* ── Addresses (repeatable) ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Addresses</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAddresses((rows) => [...rows, newAddressRow()])}
            >
              <Plus className="h-4 w-4" />
              Add address
            </Button>
          </div>
          {addresses.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">No addresses added.</p>
          )}
          {addresses.map((row, i) => (
            <div
              key={row.key}
              className="rounded-lg border border-[var(--color-border)] p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                  Address {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setAddresses((rows) => rows.filter((r) => r.key !== row.key))}
                  className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors"
                  title="Remove address"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  label="Type"
                  options={ADDRESS_TYPE_OPTIONS}
                  value={row.type}
                  onChange={(e) => updateAddress(row.key, { type: e.target.value })}
                />
                <Input
                  label="Line 1"
                  value={row.line1}
                  onChange={(e) => updateAddress(row.key, { line1: e.target.value })}
                  required
                />
                <Input
                  label="Line 2"
                  value={row.line2}
                  onChange={(e) => updateAddress(row.key, { line2: e.target.value })}
                />
                <Input
                  label="City"
                  value={row.city}
                  onChange={(e) => updateAddress(row.key, { city: e.target.value })}
                  required
                />
                <Input
                  label="State"
                  value={row.state}
                  onChange={(e) => updateAddress(row.key, { state: e.target.value })}
                  required
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="State Code"
                    placeholder="27"
                    value={row.state_code}
                    onChange={(e) => updateAddress(row.key, { state_code: e.target.value })}
                  />
                  <Input
                    label="PIN Code"
                    placeholder="400001"
                    value={row.pincode}
                    onChange={(e) => updateAddress(row.key, { pincode: e.target.value })}
                    maxLength={6}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Authorized persons (repeatable) ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Authorized Persons
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPersons((rows) => [...rows, newPersonRow()])}
            >
              <Plus className="h-4 w-4" />
              Add person
            </Button>
          </div>
          {persons.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">No authorized persons added.</p>
          )}
          {persons.map((row, i) => (
            <div
              key={row.key}
              className="rounded-lg border border-[var(--color-border)] p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                  Person {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setPersons((rows) => rows.filter((r) => r.key !== row.key))}
                  className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors"
                  title="Remove person"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Name"
                  value={row.name}
                  onChange={(e) => updatePerson(row.key, { name: e.target.value })}
                  required
                />
                <Input
                  label="Designation"
                  placeholder="Director, Partner, Karta…"
                  value={row.designation}
                  onChange={(e) => updatePerson(row.key, { designation: e.target.value })}
                />
                <Input
                  label="PAN"
                  placeholder="ABCDE1234F"
                  className="uppercase"
                  maxLength={10}
                  value={row.pan}
                  onChange={(e) => updatePerson(row.key, { pan: e.target.value })}
                />
                <Input
                  label="DIN"
                  placeholder="8 digits"
                  maxLength={8}
                  value={row.din}
                  onChange={(e) => updatePerson(row.key, { din: e.target.value })}
                />
                <Input
                  label="Email"
                  type="email"
                  value={row.email}
                  onChange={(e) => updatePerson(row.key, { email: e.target.value })}
                />
                <Input
                  label="Phone"
                  value={row.phone}
                  onChange={(e) => updatePerson(row.key, { phone: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={row.is_primary}
                  onChange={(e) => updatePerson(row.key, { is_primary: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--color-border)]"
                />
                Primary contact
              </label>
            </div>
          ))}
        </div>

        {/* ── Internal notes ── */}
        <Textarea
          label="Internal Notes"
          name="notes"
          rows={3}
          placeholder="Visible to firm staff only — never shown in the client portal."
          defaultValue={client?.notes || ''}
        />
      </div>

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {client ? 'Update Client' : 'Add Client'}
        </Button>
      </div>
    </form>
  );
}
