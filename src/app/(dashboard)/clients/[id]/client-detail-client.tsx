'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  BadgeCheck,
  ClipboardList,
  Copy,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Send,
  Star,
  UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ClientForm } from '@/components/client-form';
import { DocumentsSection } from '@/components/documents-section';
import { updateClientAction, setClientActiveAction } from '../actions';
import { inviteClientUserAction } from '../portal-actions';
import { addressTypeLabel, auditTypeLabel, businessTypeLabel, gstSchemeLabel, registrationTypeLabel } from '@/lib/ca-options';
import type {
  Client,
  ClientAddress,
  ClientAuthorizedPerson,
  ClientDocumentWithDetails,
  ClientRegistration,
  Profile,
} from '@/lib/types';

interface ClientDetailClientProps {
  client: Client;
  creator: Pick<Profile, 'id' | 'name'> | null;
  addresses: ClientAddress[];
  authorizedPersons: ClientAuthorizedPerson[];
  registrations: ClientRegistration[];
  documents: ClientDocumentWithDetails[];
  canManage: boolean;
  canUploadDocs: boolean;
  canApproveDocs: boolean;
}

export function ClientDetailClient({
  client,
  creator,
  addresses,
  authorizedPersons,
  registrations,
  documents,
  canManage,
  canUploadDocs,
  canApproveDocs,
}: ClientDetailClientProps) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [toggling, setToggling] = useState(false);

  const handleToggleActive = async () => {
    if (
      client.is_active &&
      !confirm(
        `Deactivate ${client.name}? They will be marked inactive, but all records are preserved.`
      )
    ) {
      return;
    }
    setToggling(true);
    await setClientActiveAction(client.id, !client.is_active);
    setToggling(false);
  };

  const registrationRows: { label: string; value: string | null; mono?: boolean }[] = [
    { label: 'GSTIN', value: client.gstin, mono: true },
    { label: 'PAN', value: client.pan, mono: true },
    { label: 'TAN', value: client.tan, mono: true },
    { label: 'CIN', value: client.cin, mono: true },
    {
      label: 'Incorporation Date',
      value: client.incorporation_date
        ? format(new Date(client.incorporation_date), 'MMM d, yyyy')
        : null,
    },
    {
      label: 'GST Registration Date',
      value: client.gst_registration_date
        ? format(new Date(client.gst_registration_date), 'MMM d, yyyy')
        : null,
    },
    {
      label: 'Audit Applicable',
      value: client.is_audit_applicable
        ? client.audit_type
          ? auditTypeLabel(client.audit_type)
          : 'Yes'
        : 'No',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back + header */}
      <div>
        <Link
          href="/clients"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Clients
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-[var(--color-text)]">{client.name}</h1>
              <Badge variant={client.is_active ? 'success' : 'default'}>
                {client.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              {client.trade_name ? `${client.trade_name} · ` : ''}
              {businessTypeLabel(client.business_type)}
              {creator ? ` · Added by ${creator.name}` : ''}
            </p>
          </div>

          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowInviteModal(true)}>
                <Send className="h-4 w-4" />
                Invite to Portal
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowEditModal(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={toggling}
                onClick={handleToggleActive}
              >
                {client.is_active ? (
                  <>
                    <Archive className="h-4 w-4" />
                    Deactivate
                  </>
                ) : (
                  <>
                    <ArchiveRestore className="h-4 w-4" />
                    Reactivate
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Registration + contact */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-[var(--color-accent)]" />
            Registration Details
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {registrationRows.map((row) => (
              <div key={row.label}>
                <dt className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
                  {row.label}
                </dt>
                <dd
                  className={`text-sm text-[var(--color-text)] mt-0.5 ${row.mono ? 'font-mono' : ''}`}
                >
                  {row.value || '—'}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <UserRound className="h-5 w-5 text-[var(--color-accent)]" />
            Contact
          </h2>
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-[var(--color-text)]">
              <Mail className="h-4 w-4 text-[var(--color-text-muted)]" />
              {client.email || '—'}
            </p>
            <p className="flex items-center gap-2 text-[var(--color-text)]">
              <Phone className="h-4 w-4 text-[var(--color-text-muted)]" />
              {client.phone || '—'}
            </p>
            {client.notes && (
              <div className="rounded-lg bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-3 py-2 text-[var(--color-text)]">
                <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                  Internal notes
                </p>
                {client.notes}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Addresses */}
      <Card>
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <MapPin className="h-5 w-5 text-[var(--color-accent)]" />
          Addresses
          <span className="text-sm font-normal text-[var(--color-text-muted)]">
            ({addresses.length})
          </span>
        </h2>
        {addresses.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No addresses on file.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {addresses.map((address) => (
              <div
                key={address.id}
                className="rounded-lg border border-[var(--color-border)] p-4"
              >
                <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
                  {addressTypeLabel(address.type)}
                </span>
                <p className="text-sm text-[var(--color-text)] mt-2">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}
                </p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {address.city}, {address.state}
                  {address.state_code ? ` (${address.state_code})` : ''}
                  {address.pincode ? ` — ${address.pincode}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Statutory registrations */}
      <Card>
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <BadgeCheck className="h-5 w-5 text-[var(--color-accent)]" />
          Statutory Registrations
          <span className="text-sm font-normal text-[var(--color-text-muted)]">
            ({registrations.length})
          </span>
        </h2>
        {registrations.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No registrations on file.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {registrations.map((reg) => (
              <div
                key={reg.id}
                className="rounded-lg border border-[var(--color-border)] p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
                    {registrationTypeLabel(reg.type)}
                  </span>
                  {!reg.is_active && <Badge variant="default">Inactive</Badge>}
                </div>
                <p className="text-sm font-mono text-[var(--color-text)] mt-2">
                  {reg.registration_number}
                </p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {[
                    reg.gst_scheme ? gstSchemeLabel(reg.gst_scheme) : null,
                    reg.state,
                    reg.state_code ? `(${reg.state_code})` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Authorized persons */}
      <Card>
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <UserRound className="h-5 w-5 text-[var(--color-accent)]" />
          Authorized Persons
          <span className="text-sm font-normal text-[var(--color-text-muted)]">
            ({authorizedPersons.length})
          </span>
        </h2>
        {authorizedPersons.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No authorized persons on file.</p>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {authorizedPersons.map((person) => (
              <div key={person.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-text)]">
                    {person.name}
                  </span>
                  {person.is_primary && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[var(--color-warning-bg)] text-[var(--color-warning)]">
                      <Star className="h-3 w-3" />
                      Primary
                    </span>
                  )}
                  {person.designation && (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {person.designation}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {[
                    person.pan ? `PAN ${person.pan}` : null,
                    person.din ? `DIN ${person.din}` : null,
                    person.email,
                    person.phone,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Documents */}
      <DocumentsSection
        documents={documents}
        clientId={client.id}
        viewer="staff"
        canUpload={canUploadDocs}
        canApprove={canApproveDocs}
      />

      {/* Tasks placeholder — module comes in a later phase */}
      <Card>
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-2 flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-[var(--color-accent)]" />
          Tasks
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Compliance tasks for this client will appear here once the Tasks module is built.
        </p>
      </Card>

      {/* Edit modal — preloads the full address/person sets, which the
          replace-all update action requires. */}
      <Modal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Client"
        maxWidth="lg"
      >
        {showEditModal && (
          <ClientForm
            client={client}
            addresses={addresses}
            authorizedPersons={authorizedPersons}
            registrations={registrations}
            action={updateClientAction}
            onSuccess={() => setShowEditModal(false)}
            onCancel={() => setShowEditModal(false)}
          />
        )}
      </Modal>

      {/* Invite to portal */}
      <Modal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Invite to Client Portal"
      >
        <InvitePortalForm clientId={client.id} defaultEmail={client.email || ''} />
      </Modal>
    </div>
  );
}

function InvitePortalForm({
  clientId,
  defaultEmail,
}: {
  clientId: string;
  defaultEmail: string;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await inviteClientUserAction(clientId, email);

    if (result.success && result.data) {
      setInviteUrl(result.data.inviteUrl);
    } else {
      setError(result.error || 'Failed to create the invitation.');
    }
    setLoading(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the URL is selectable below.
    }
  };

  if (inviteUrl) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-text)]">
          Invitation created. Email sending isn&apos;t wired up yet — share this
          link with the client directly (valid for 7 days):
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-[var(--color-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2 break-all select-all">
            {inviteUrl}
          </code>
          <Button variant="secondary" size="sm" onClick={handleCopy}>
            <Copy className="h-4 w-4" />
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Client's email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="person@client.com"
        required
        hint="They'll set a password via the invitation link and see only this client's data."
      />

      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={loading}>
          <Send className="h-4 w-4" />
          Create invitation
        </Button>
      </div>
    </form>
  );
}
