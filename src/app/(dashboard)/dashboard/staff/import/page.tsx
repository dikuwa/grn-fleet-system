'use client';

import { useState, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import { useSession } from '@/lib/auth-client';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import {
  Upload,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react';
import Link from 'next/link';

type Step = 'upload' | 'mapping' | 'preview' | 'committing' | 'complete';

interface ImportRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
  isDuplicate: boolean;
}

const STAFF_TEMPLATE_COLUMNS = [
  { key: 'employee_number', label: 'Employee Number', required: true },
  { key: 'first_name', label: 'First Name', required: true },
  { key: 'last_name', label: 'Last Name', required: true },
  { key: 'title', label: 'Title', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'job_title', label: 'Job Title', required: false },
  { key: 'department', label: 'Department', required: false },
  { key: 'office', label: 'Office', required: false },
  { key: 'employment_status', label: 'Employment Status', required: false },
] as const;

export default function StaffImportPage() {
  const { data: session } = useSession();
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string>('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [currentPreviewPage, setCurrentPreviewPage] = useState(1);
  const [isCommitting, setIsCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewPageSize = 10;

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    // Parse CSV using papaparse (handles quotes, commas in fields, headers)
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.data.length < 1) return;

        const headers = result.data[0].map((h: string) => h.trim());
        const parsedRows: ImportRow[] = result.data.slice(1).map(
          (values: string[], idx: number) => {
            const rowData: Record<string, string> = {};
            headers.forEach((h, i) => {
              rowData[h] = (values[i] || '').trim();
            });
            return {
              rowNumber: idx + 2,
              data: rowData,
              errors: [],
              isDuplicate: false,
            };
          },
        );

        // Auto-map known columns
        const mapping: Record<string, string> = {};
        for (const col of STAFF_TEMPLATE_COLUMNS) {
          const match = headers.find(
            (h) =>
              h.toLowerCase().replace(/[\s_-]/g, '') ===
              col.key.toLowerCase().replace(/[\s_-]/g, ''),
          );
          if (match) {
            mapping[match] = col.key;
          }
        }
        setColumnMapping(mapping);

        // Validate
        const validated = parsedRows.map((row) => {
          const errors: string[] = [];
          for (const col of STAFF_TEMPLATE_COLUMNS) {
            if (!col.required) continue;
            const mappedKey = Object.entries(mapping).find(
              ([, v]) => v === col.key,
            )?.[0];
            if (!mappedKey || !row.data[mappedKey]?.trim()) {
              errors.push(`Missing required field: ${col.label}`);
            }
          }
          return { ...row, errors };
        });
        setRows(validated);

        setStep('mapping');
      },
      error: () => {
        // Silently fail — user can retry
      },
    });
  }, []);

  const handleCommitImport = useCallback(async () => {
    setIsCommitting(true);
    setStep('committing');

    try {
      const payload = rows
        .filter((r) => r.errors.length === 0)
        .map((r) => {
          const mapped: Record<string, string> = {};
          for (const [csvCol, schemaCol] of Object.entries(columnMapping)) {
            mapped[schemaCol] = r.data[csvCol] || '';
          }
          return mapped;
        });

      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: payload,
          tenantId: '00000000-0000-0000-0000-000000000000',
          userId: session?.user?.id || 'system',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Import failed');
      }

      setStep('complete');
    } catch (err) {
      console.error('Import failed:', err);
      console.error('Import failed:', err);
      setStep('preview');
    } finally {
      setIsCommitting(false);
    }
  }, [rows, columnMapping, session]);

  const totalValidRows = rows.filter((r) => r.errors.length === 0).length;
  const totalErrorRows = rows.filter((r) => r.errors.length > 0).length;
  const previewRows = rows.slice(
    (currentPreviewPage - 1) * previewPageSize,
    currentPreviewPage * previewPageSize,
  );
  const previewTotalPages = Math.ceil(rows.length / previewPageSize);

  const allHeaders = rows.length > 0 ? Object.keys(rows[0].data) : [];
  const unmappedColumns = allHeaders.filter((h) => !columnMapping[h]);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Staff Directory', href: '/dashboard/staff' },
          { label: 'Import Staff' },
        ]}
      />
      <PageHeader
        title="Import Staff Records"
        description="Upload a CSV file to import employee records in bulk"
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/staff">
            <ChevronLeft className="h-4 w-4" />
            Back to Directory
          </Link>
        </Button>
        <Button variant="tertiary" size="sm" asChild>
          <a href="/staff-import-template.csv" download>
            <Download className="h-4 w-4" />
            Download Template
          </a>
        </Button>
      </PageHeader>

      {/* Step indicator */}
      <div className="flex items-center gap-2 rounded-[10px] border border-border bg-surface p-4">
        {(['upload', 'mapping', 'preview', 'complete'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                step === s || (step === 'committing' && s === 'preview')
                  ? 'bg-brand-800 text-white'
                  : ['upload', 'mapping', 'preview', 'complete'].indexOf(s) <
                      ['upload', 'mapping', 'preview', 'complete'].indexOf(
                        step === 'committing' || step === 'complete' ? 'preview' : step,
                      )
                    ? 'bg-status-success-bg text-status-success-text'
                    : 'bg-muted text-ink-500'
              }`}
            >
              {i + 1}
            </div>
            <span
              className={`text-xs font-medium ${
                step === s || (step === 'committing' && s === 'preview')
                  ? 'text-ink-950'
                  : ['upload', 'mapping', 'preview', 'complete'].indexOf(s) <
                      ['upload', 'mapping', 'preview', 'complete'].indexOf(
                        step === 'committing' || step === 'complete' ? 'preview' : step,
                      )
                    ? 'text-status-success-text'
                    : 'text-ink-500'
              }`}
            >
              {s === 'upload' ? 'Upload' : s === 'mapping' ? 'Column Mapping' : s === 'preview' ? 'Review & Confirm' : 'Complete'}
            </span>
            {i < 3 && <ChevronRight className="h-3 w-3 text-ink-300" />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <Card>
          <CardContent className="pt-6">
            <div
              className="flex flex-col items-center justify-center rounded-[10px] border-2 border-dashed border-border bg-canvas px-6 py-16 text-center cursor-pointer hover:border-brand-300 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
                <Upload className="h-8 w-8 text-brand-700" />
              </div>
              <h3 className="text-base font-semibold text-ink-950">Upload CSV File</h3>
              <p className="mt-1 max-w-sm text-sm text-ink-500">
                Drag and drop your CSV file here, or click to browse. The file should contain employee data with column headers.
              </p>
              <div className="mt-6 flex items-center gap-4 text-xs text-ink-500">
                <span>Supported: .csv</span>
                <span className="text-ink-300">|</span>
                <span>Max: 10MB</span>
                <span className="text-ink-300">|</span>
                <span>Template available</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Column Mapping */}
      {step === 'mapping' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Column Mapping</CardTitle></CardHeader>
            <CardContent>
              {unmappedColumns.length > 0 && (
                <div className="mb-4 flex items-center gap-2 rounded-[8px] bg-status-pending-bg px-3 py-2 text-xs font-medium text-status-pending-text">
                  <AlertCircle className="h-4 w-4" />
                  {unmappedColumns.length} column{unmappedColumns.length !== 1 ? 's' : ''} not mapped: {unmappedColumns.slice(0, 3).join(', ')}
                  {unmappedColumns.length > 3 && ` +${unmappedColumns.length - 3} more`}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">CSV Column</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Maps To</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Required</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {STAFF_TEMPLATE_COLUMNS.map((col) => {
                      const mappedFrom = Object.entries(columnMapping).find(([, v]) => v === col.key)?.[0];
                      return (
                        <tr key={col.key} className="hover:bg-canvas/50">
                          <td className="px-3 py-2 text-ink-700">{mappedFrom || <span className="text-ink-400 italic">Not mapped</span>}</td>
                          <td className="px-3 py-2"><span className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-ink-700">{col.key}</span></td>
                          <td className="px-3 py-2">{col.required ? <StatusBadge status="error" label="Required" /> : <span className="text-xs text-ink-500">Optional</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setStep('upload')}>Back</Button>
            <Button variant="primary" size="sm" onClick={() => setStep('preview')} disabled={rows.length === 0}>
              Continue to Preview <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Preview & Confirm */}
      {step === 'preview' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card><CardContent className="pt-4"><div className="text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{rows.length}</p><p className="text-xs text-ink-500">Total Rows</p></div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="text-center"><p className="text-2xl font-[650] tabular-nums text-status-success-text">{totalValidRows}</p><p className="text-xs text-ink-500">Valid</p></div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="text-center"><p className="text-2xl font-[650] tabular-nums text-status-error-text">{totalErrorRows}</p><p className="text-xs text-ink-500">Errors</p></div></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Data Preview</CardTitle><span className="text-xs text-ink-500">Page {currentPreviewPage} of {previewTotalPages}</span></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted">
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">#</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Employee #</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Name</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Email</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Job Title</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewRows.map((row) => {
                      const empNo = row.data[Object.entries(columnMapping).find(([, v]) => v === 'employee_number')?.[0] || ''];
                      const firstName = row.data[Object.entries(columnMapping).find(([, v]) => v === 'first_name')?.[0] || ''];
                      const lastName = row.data[Object.entries(columnMapping).find(([, v]) => v === 'last_name')?.[0] || ''];
                      const email = row.data[Object.entries(columnMapping).find(([, v]) => v === 'email')?.[0] || ''];
                      const jobTitle = row.data[Object.entries(columnMapping).find(([, v]) => v === 'job_title')?.[0] || ''];

                      return (
                        <tr key={row.rowNumber} className={`hover:bg-canvas/50 transition-colors ${row.errors.length > 0 ? 'bg-status-error-bg/30' : ''}`}>
                          <td className="px-3 py-2 text-xs text-ink-500">{row.rowNumber}</td>
                          <td className="px-3 py-2 text-xs tabular-nums text-ink-700">{empNo || '—'}</td>
                          <td className="px-3 py-2 text-sm text-ink-700">{firstName} {lastName}</td>
                          <td className="px-3 py-2 text-sm text-ink-500">{email || '—'}</td>
                          <td className="px-3 py-2 text-sm text-ink-500">{jobTitle || '—'}</td>
                          <td className="px-3 py-2">{row.errors.length > 0 ? <div className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-status-error-text" /><span className="text-xs text-status-error-text">{row.errors.length} error{row.errors.length !== 1 ? 's' : ''}</span></div> : <CheckCircle2 className="h-3.5 w-3.5 text-status-success-text" />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {previewTotalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-4 py-3">
                  <p className="text-xs text-ink-500">Showing {(currentPreviewPage - 1) * previewPageSize + 1}–{Math.min(currentPreviewPage * previewPageSize, rows.length)} of {rows.length}</p>
                  <div className="flex items-center gap-2">
                    <button className="h-8 rounded-[6px] border border-border px-3 text-xs text-ink-500 hover:bg-muted transition-colors disabled:opacity-50" disabled={currentPreviewPage <= 1} onClick={() => setCurrentPreviewPage((p) => Math.max(1, p - 1))}><ChevronLeft className="h-3 w-3" /></button>
                    <button className="h-8 rounded-[6px] border border-border px-3 text-xs text-ink-500 hover:bg-muted transition-colors disabled:opacity-50" disabled={currentPreviewPage >= previewTotalPages} onClick={() => setCurrentPreviewPage((p) => Math.min(previewTotalPages, p + 1))}><ChevronRight className="h-3 w-3" /></button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {totalErrorRows > 0 && (
            <Card>
              <CardHeader><CardTitle>Validation Errors</CardTitle><StatusBadge status="error" label={`${totalErrorRows} rows affected`} /></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {rows.filter((r) => r.errors.length > 0).slice(0, 5).map((row) => (
                    <div key={row.rowNumber} className="rounded-[8px] border border-status-error-bg bg-status-error-bg/30 p-3">
                      <p className="text-xs font-medium text-status-error-text">Row {row.rowNumber}</p>
                      <ul className="mt-1 list-inside list-disc text-xs text-status-error-text/80">
                        {row.errors.map((err, i) => (<li key={i}>{err}</li>))}
                      </ul>
                    </div>
                  ))}
                  {totalErrorRows > 5 && <p className="text-xs text-ink-500">...and {totalErrorRows - 5} more rows with errors</p>}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-500">{fileName} · {totalValidRows} valid, {totalErrorRows} with errors</p>
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => setStep('mapping')}>Back</Button>
              {totalValidRows > 0 && (
                <Button variant="primary" size="sm" onClick={handleCommitImport} loading={isCommitting}>
                  <CheckCircle2 className="h-4 w-4" />
                  Import {totalValidRows} Valid Record{totalValidRows !== 1 ? 's' : ''}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Committing step */}
      {step === 'committing' && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mb-4 flex items-center justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-700 border-t-transparent" />
              </div>
            </div>
            <h3 className="text-lg font-semibold text-ink-950">Importing Records...</h3>
            <p className="mt-1 text-sm text-ink-500">Validating and inserting employee records into the database.</p>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Complete */}
      {step === 'complete' && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mb-4 flex items-center justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-status-success-bg">
                <CheckCircle2 className="h-8 w-8 text-status-success-text" />
              </div>
            </div>
            <h3 className="text-lg font-semibold text-ink-950">Import Complete</h3>
            <p className="mt-1 text-sm text-ink-500">
              Successfully imported {totalValidRows} employee records.
              {totalErrorRows > 0 && ` ${totalErrorRows} rows had errors and were skipped.`}
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="secondary" size="sm" asChild>
                <Link href="/dashboard/staff/import">Import Another File</Link>
              </Button>
              <Button variant="primary" size="sm" asChild>
                <Link href="/dashboard/staff">View Staff Directory</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
