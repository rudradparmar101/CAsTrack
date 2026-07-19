'use client';

import React, { useRef, useState } from 'react';
import { Download, Upload, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { previewClientImportAction, commitClientImportAction } from './import-actions';
import type { ImportRow, ImportRowResult } from './import-actions';

interface ClientImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

type Stage = 'pick' | 'preview' | 'result';

const STATUS_BADGE: Record<ImportRowResult['status'], { variant: 'success' | 'warning' | 'danger' | 'default'; label: string }> = {
  valid: { variant: 'default', label: 'Ready' },
  created: { variant: 'success', label: 'Created' },
  duplicate: { variant: 'warning', label: 'Duplicate' },
  invalid: { variant: 'danger', label: 'Invalid' },
};

export function ClientImportModal({ onClose, onImported }: ClientImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('pick');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [results, setResults] = useState<ImportRowResult[]>([]);
  const [createdCount, setCreatedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validCount = results.filter((r) => r.status === 'valid').length;
  const invalidCount = results.filter((r) => r.status === 'invalid').length;
  const duplicateCount = results.filter((r) => r.status === 'duplicate').length;

  const handlePreview = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Choose a CSV file first.');
      return;
    }
    setFileName(file.name);
    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.set('file', file);
    const result = await previewClientImportAction(formData);

    if (result.success && result.data) {
      setRows(result.data.rows);
      setResults(result.data.results);
      setStage('preview');
    } else {
      setError(result.error || 'Could not read that file.');
    }
    setLoading(false);
  };

  const handleCommit = async () => {
    setLoading(true);
    setError('');
    const result = await commitClientImportAction(rows);
    if (result.success && result.data) {
      setResults(result.data.results);
      setCreatedCount(result.data.createdCount);
      setStage('result');
      if (result.data.createdCount > 0) onImported();
    } else {
      setError(result.error || 'Import failed.');
    }
    setLoading(false);
  };

  const handleStartOver = () => {
    setStage('pick');
    setRows([]);
    setResults([]);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      {stage === 'pick' && (
        <>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Import multiple clients at once from a CSV file. This creates the same core client
            record you&rsquo;d get from &ldquo;Add Client&rdquo; — addresses, authorized persons,
            and GST/TAN registrations aren&rsquo;t imported this way yet; add those afterward on
            each client&rsquo;s page.
          </p>

          <a
            href="/templates/client-import-template.csv"
            download
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
          >
            <Download className="h-4 w-4" />
            Download CSV template
          </a>

          <div className="rounded-lg bg-[var(--color-muted)] px-4 py-3 text-xs text-[var(--color-text-secondary)] space-y-1">
            <p>
              <strong>Required:</strong> name
            </p>
            <p>
              <strong>business_type</strong> must be one of: individual, huf, proprietorship,
              partnership, llp, opc, pvt_ltd, public_ltd, trust, society, aop_boi, government,
              other (defaults to individual if left blank on the form, but the importer requires
              an exact match — see the template).
            </p>
            <p>
              <strong>is_audit_applicable</strong>: true or false (case-insensitive; blank = false).
            </p>
            <p>
              <strong>audit_type</strong> (only used when is_audit_applicable is true): tax_audit,
              statutory_audit, gst_audit, other.
            </p>
            <p>
              Rows with an invalid format, or a PAN that already exists in this firm, are skipped
              and reported — they never overwrite an existing client.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-sm text-[var(--color-text)] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[var(--color-accent-muted)] file:text-[var(--color-accent)] file:text-sm file:font-medium hover:file:bg-[var(--color-accent-muted)]/80"
          />

          {error && (
            <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" loading={loading} onClick={handlePreview}>
              <Upload className="h-4 w-4" />
              Preview
            </Button>
          </div>
        </>
      )}

      {stage === 'preview' && (
        <>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Reviewed <strong>{fileName}</strong> — {results.length} row{results.length !== 1 ? 's' : ''}.
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="default">
              <CheckCircle2 className="h-3 w-3" /> {validCount} ready
            </Badge>
            {duplicateCount > 0 && (
              <Badge variant="warning">
                <AlertTriangle className="h-3 w-3" /> {duplicateCount} duplicate
              </Badge>
            )}
            {invalidCount > 0 && (
              <Badge variant="danger">
                <XCircle className="h-3 w-3" /> {invalidCount} invalid
              </Badge>
            )}
          </div>

          <ImportResultsTable results={results} />

          {error && (
            <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-3 text-sm text-[var(--color-danger-text)]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 sticky bottom-0 bg-[var(--color-surface)]">
            <Button type="button" variant="ghost" onClick={handleStartOver}>
              Choose a different file
            </Button>
            <Button type="button" loading={loading} disabled={validCount === 0} onClick={handleCommit}>
              Import {validCount} client{validCount !== 1 ? 's' : ''}
            </Button>
          </div>
        </>
      )}

      {stage === 'result' && (
        <>
          <div className="rounded-lg bg-[var(--color-success-bg)] border border-[var(--color-success-border)] px-4 py-3 text-sm text-[var(--color-success-text)]">
            Created {createdCount} client{createdCount !== 1 ? 's' : ''}.
          </div>

          <ImportResultsTable results={results} />

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ImportResultsTable({ results }: { results: ImportRowResult[] }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border)]">
      <table className="min-w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-[var(--color-surface)]">
          <tr className="text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            <th className="px-3 py-2">Row</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {results.map((r) => (
            <tr key={r.rowNumber}>
              <td className="px-3 py-2 text-[var(--color-text-muted)]">{r.rowNumber}</td>
              <td className="px-3 py-2 text-[var(--color-text)]">{r.name}</td>
              <td className="px-3 py-2">
                <Badge variant={STATUS_BADGE[r.status].variant}>{STATUS_BADGE[r.status].label}</Badge>
              </td>
              <td className="px-3 py-2 text-[var(--color-text-secondary)]">{r.error || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
