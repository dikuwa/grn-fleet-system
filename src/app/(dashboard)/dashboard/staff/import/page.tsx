'use client';

import { useState, useRef, useCallback } from 'react';
import { parseImportFile } from '@/lib/file-import';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StyledSelect } from '@/components/ui/styled-select';
import { StatusBadge } from '@/components/ui/badge';
import {
  Upload,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import Link from 'next/link';

type Step = 'upload' | 'mapping' | 'preview' | 'committing' | 'complete';

interface ImportRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
  isDuplicate: boolean;
}

const STAFF_TEMPLATE_COLUMNS = [
  { key: 'employee_number', label: 'Employee Number', required: false },
  { key: 'title', label: 'Title', required: false },
  { key: 'first_name', label: 'First Name', required: true },
  { key: 'middle_names', label: 'Middle Names', required: false },
  { key: 'last_name', label: 'Last Name', required: true },
  { key: 'gender', label: 'Gender', required: false },
  { key: 'job_title', label: 'Job Title', required: false },
  { key: 'job_grade', label: 'Job Grade', required: false },
  { key: 'department', label: 'Department', required: false },
  { key: 'office', label: 'Office', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'employment_status', label: 'Employment Status', required: false },
  { key: 'is_driver', label: 'Is Driver', required: false },
] as const;

export default function StaffImportPage() {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string>('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [currentPreviewPage, setCurrentPreviewPage] = useState(1);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [importResult, setImportResult] = useState<{ createdRows: number; generatedNumbers: number; driversCreated: number } | null>(null);
  const [reviewedSkippedRows, setReviewedSkippedRows] = useState(0);
  const [organisationOptions, setOrganisationOptions] = useState<{ departments: Array<{ id: string; name: string }>; offices: Array<{ id: string; name: string }> }>({ departments: [], offices: [] });
  const [entityMapping, setEntityMapping] = useState<{ department: Record<string, string>; office: Record<string, string> }>({ department: {}, office: {} });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewPageSize = 10;

  const loadOrganisationOptions = useCallback(async () => {
    const [departmentData, officeData] = await Promise.all([fetch('/api/departments').then((response) => response.json()), fetch('/api/offices').then((response) => response.json())]);
    const options = { departments: departmentData.data ?? [], offices: officeData.data ?? [] };
    setOrganisationOptions(options);
    return options;
  }, []);

  const normaliseEntity = useCallback((value: string) => value.trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim(), []);

  const refreshEntityMappings = useCallback((inputRows: ImportRow[], mapping: Record<string, string>, availableOptions = organisationOptions) => {
    setEntityMapping((current) => {
      const next = { department: { ...current.department }, office: { ...current.office } };
      for (const kind of ['department', 'office'] as const) {
        const sourceHeader = Object.entries(mapping).find(([, target]) => target === kind)?.[0];
        if (!sourceHeader) continue;
        const options = availableOptions[kind === 'department' ? 'departments' : 'offices'];
        for (const row of inputRows) {
          const sourceValue = row.data[sourceHeader]?.trim();
          if (!sourceValue || next[kind][sourceValue] !== undefined) continue;
          const exact = options.find((option) => normaliseEntity(option.name) === normaliseEntity(sourceValue));
          next[kind][sourceValue] = exact?.name ?? '';
        }
      }
      return next;
    });
  }, [normaliseEntity, organisationOptions]);

  const createOrganisationRecord = useCallback(async (kind: 'department' | 'office', sourceValue: string) => {
    try {
      const response = await fetch(`/api/${kind === 'department' ? 'departments' : 'offices'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'department' ? { name: sourceValue, type: 'department' } : { name: sourceValue, type: 'other' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Failed to create ${kind}`);
      const optionKey = kind === 'department' ? 'departments' : 'offices';
      setOrganisationOptions((current) => ({ ...current, [optionKey]: [...current[optionKey], data.data] }));
      setEntityMapping((current) => ({ ...current, [kind]: { ...current[kind], [sourceValue]: data.data.name } }));
      toast({ title: kind === 'department' ? 'Department created' : 'Office created', description: `${data.data.name} is now selected for this import.`, variant: 'success' });
    } catch (error) {
      toast({ title: 'Record not created', description: error instanceof Error ? error.message : 'Please try again.', variant: 'error' });
    }
  }, [toast]);

  const downloadTemplate = useCallback(async () => {
    setIsDownloading(true);
    try {
      const response = await fetch('/staff-import-template.csv');
      if (!response.ok) throw new Error('Template download failed.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'govfleet-staff-import-template.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: 'Template download failed', description: error instanceof Error ? error.message : 'Please try again.', variant: 'error' });
    } finally {
      setIsDownloading(false);
    }
  }, [toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setEntityMapping({ department: {}, office: {} });

    Promise.all([
      parseImportFile(file),
      organisationOptions.departments.length > 0 || organisationOptions.offices.length > 0
        ? Promise.resolve(organisationOptions)
        : loadOrganisationOptions(),
    ])
      .then(([parsed, availableOptions]) => {
        const headers = parsed.headers;
        const parsedRows: ImportRow[] = parsed.rows.map(
          (rowData: Record<string, string>, idx: number) => ({
            rowNumber: idx + 2,
            data: rowData,
            errors: [],
            isDuplicate: false,
          }),
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
        refreshEntityMappings(validated, mapping, availableOptions);

        setStep('mapping');
      })
      .catch((err) => {
        toast({ title: 'Parse Error', description: err.message, variant: 'error' });
      });
  }, [loadOrganisationOptions, organisationOptions, refreshEntityMappings, toast]);

  const revalidateRows = useCallback((mapping: Record<string, string>) => {
    setRows((current) => {
      const seenNumbers = new Set<string>();
      return current.map((row) => {
        const errors: string[] = [];
        for (const col of STAFF_TEMPLATE_COLUMNS) {
          if (!col.required) continue;
          const sourceHeader = Object.entries(mapping).find(([, target]) => target === col.key)?.[0];
          if (!sourceHeader || !row.data[sourceHeader]?.trim()) errors.push(`Missing required field: ${col.label}`);
        }
        const employeeHeader = Object.entries(mapping).find(([, target]) => target === 'employee_number')?.[0];
        const employeeNumber = employeeHeader ? row.data[employeeHeader]?.trim().toLowerCase() : '';
        if (employeeNumber) {
          if (seenNumbers.has(employeeNumber)) errors.push('Duplicate employee number in this file.');
          seenNumbers.add(employeeNumber);
        }
        return { ...row, errors };
      });
    });
  }, []);

  const totalValidRows = rows.filter((r) => r.errors.length === 0).length;

  const handleCommitImport = useCallback(async () => {
    setIsCommitting(true);
    setStep('committing');

    try {
      let skippedRows = 0;
      const payload = rows
        .filter((r) => r.errors.length === 0)
        .map((r) => {
          const mapped: Record<string, string> = {};
          for (const [csvCol, schemaCol] of Object.entries(columnMapping)) {
            mapped[schemaCol] = r.data[csvCol] || '';
          }
          for (const kind of ['department', 'office'] as const) {
            const sourceValue = mapped[kind]?.trim();
            if (!sourceValue) continue;
            const resolution = entityMapping[kind][sourceValue];
            if (resolution === '__skip__') { skippedRows++; return null; }
            mapped[kind] = resolution === '__unassigned__' ? '' : resolution || sourceValue;
          }
          return mapped;
        }).filter((row): row is Record<string, string> => row !== null);

      if (payload.length === 0) throw new Error('Every row is marked to skip; there is nothing to import.');
      setReviewedSkippedRows(skippedRows);

      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: payload,
          fileName,
          columnMapping,
          entityMapping,
          reviewedSkippedRows: skippedRows,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const err = data;
        if (Array.isArray(err.rowErrors)) {
          const byRow = new Map<number, string[]>(err.rowErrors.map((item: { rowNumber: number; errors: string[] }) => [item.rowNumber, item.errors]));
          setRows((current) => current.map((row) => ({ ...row, errors: byRow.get(row.rowNumber) ?? row.errors })));
        }
        throw new Error(err.error || 'Import failed');
      }

      setImportResult(data);
      toast({ title: 'Import complete', description: `${data.createdRows} staff record(s) imported successfully`, variant: 'success' });
      setStep('complete');
    } catch (err) {
      toast({ title: 'Import failed', description: err instanceof Error ? err.message : 'An error occurred during import', variant: 'error' });
      console.error('Import failed:', err);
      setStep('preview');
    } finally {
      setIsCommitting(false);
    }
  }, [rows, columnMapping, entityMapping, fileName, toast]);

  const totalErrorRows = rows.filter((r) => r.errors.length > 0).length;
  const previewRows = rows.slice(
    (currentPreviewPage - 1) * previewPageSize,
    currentPreviewPage * previewPageSize,
  );
  const previewTotalPages = Math.ceil(rows.length / previewPageSize);

  const allHeaders = rows.length > 0 ? Object.keys(rows[0].data) : [];
  const unmappedColumns = allHeaders.filter((h) => !columnMapping[h]);
  const unresolvedEntities = (['department', 'office'] as const).flatMap((kind) => Object.entries(entityMapping[kind]).filter(([, resolution]) => !resolution).map(([sourceValue]) => ({ kind, sourceValue })));

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
        description="Upload a CSV or Excel file, validate it, map tenant records and review before importing"
      >
        <Button variant="tertiary" size="sm" onClick={downloadTemplate} loading={isDownloading}>
          <Download className="h-4 w-4" />
          Download Template
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/staff">
            <ChevronLeft className="h-4 w-4" />
            Back to Directory
          </Link>
        </Button>
      </PageHeader>

      {/* Step indicator */}
      <div className="flex max-w-full items-center gap-2 overflow-x-auto rounded-[10px] border border-border bg-surface p-4">
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
              <h3 className="text-base font-semibold text-ink-950">Upload File</h3>
              <p className="mt-1 max-w-sm text-sm text-ink-500">
                Drag and drop your CSV or Excel file here, or click to browse. The file should contain employee data with column headers.
              </p>
              <div className="mt-6 flex items-center gap-4 text-xs text-ink-500">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>Supported: .csv, .xlsx</span>
                <span className="text-ink-300">|</span>
                <span>Max: 10MB</span>
                <span className="text-ink-300">|</span>
                <span>Template available</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFileSelect} />
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
              <div className="max-w-full overflow-x-auto">
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
                          <td className="min-w-48 px-3 py-2 text-ink-700">
                            <StyledSelect
                              value={mappedFrom || ''}
                              onChange={(event) => {
                                const source = event.target.value;
                                const next = Object.fromEntries(Object.entries(columnMapping).filter(([, target]) => target !== col.key));
                                if (source) next[source] = col.key;
                                setColumnMapping(next);
                                revalidateRows(next);
                                refreshEntityMappings(rows, next);
                              }}
                            >
                              <option value="">Not mapped</option>
                              {allHeaders.map((header) => (
                                <option key={header} value={header} disabled={Boolean(columnMapping[header] && columnMapping[header] !== col.key)}>{header}</option>
                              ))}
                            </StyledSelect>
                          </td>
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
          {(Object.keys(entityMapping.department).length > 0 || Object.keys(entityMapping.office).length > 0) && (
            <Card>
              <CardHeader><CardTitle>Office and Department Mapping</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {(['department', 'office'] as const).flatMap((kind) => Object.keys(entityMapping[kind]).map((sourceValue) => {
                  const options = organisationOptions[kind === 'department' ? 'departments' : 'offices'];
                  return (
                    <div key={`${kind}-${sourceValue}`} className="border-border grid gap-2 rounded-[8px] border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0"><p className="text-ink-500 text-xs capitalize">Imported {kind}</p><p className="text-ink-950 break-words text-sm font-medium">{sourceValue}</p></div>
                      <StyledSelect value={entityMapping[kind][sourceValue]} onChange={(event) => setEntityMapping((current) => ({ ...current, [kind]: { ...current[kind], [sourceValue]: event.target.value } }))}>
                        <option value="">Choose a resolution</option>
                        {options.map((option) => <option key={option.id} value={option.name}>Map to {option.name}</option>)}
                        <option value="__unassigned__">Leave unassigned</option>
                        <option value="__skip__">Skip affected rows</option>
                      </StyledSelect>
                      <Button variant="secondary" size="sm" onClick={() => createOrganisationRecord(kind, sourceValue)}>Create New</Button>
                    </div>
                  );
                }))}
                <p className="text-ink-500 text-xs">Exact normalised matches are selected automatically. Creating a record is explicit and tenant-scoped; skipped rows are excluded only after this reviewed choice.</p>
              </CardContent>
            </Card>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setStep('upload')}>Back</Button>
            <Button variant="primary" size="sm" onClick={() => { revalidateRows(columnMapping); setStep('preview'); }} disabled={rows.length === 0 || unresolvedEntities.length > 0 || STAFF_TEMPLATE_COLUMNS.some((col) => col.required && !Object.values(columnMapping).includes(col.key))}>
              Continue to Preview <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Preview & Confirm */}
      {step === 'preview' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Defaults Applied to Every Imported Row</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="border-border rounded-[8px] border p-3">
                  <p className="text-ink-500 text-xs">Employment status</p>
                  <p className="text-status-success-text mt-0.5 font-medium">Active</p>
                </div>
                <div className="border-border rounded-[8px] border p-3">
                  <p className="text-ink-500 text-xs">Availability</p>
                  <p className="text-ink-950 mt-0.5 font-medium">Available</p>
                </div>
                <div className="border-border rounded-[8px] border p-3">
                  <p className="text-ink-500 text-xs">Login account</p>
                  <p className="text-ink-950 mt-0.5 font-medium">Not created</p>
                </div>
                <div className="border-border rounded-[8px] border p-3">
                  <p className="text-ink-500 text-xs">Driver profile</p>
                  <p className="text-ink-950 mt-0.5 font-medium">Only when “Is Driver” is Yes</p>
                </div>
              </div>
              <p className="text-ink-500 mt-3 text-xs">
                A blank or invalid employment status is treated as <span className="text-status-success-text font-medium">Active</span>. Case variants
                (ACTIVE / Active / active) and legacy values are normalised to canonical statuses. Accounts are never
                created by an import, and availability always starts as Available.
              </p>
            </CardContent>
          </Card>

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
              {totalValidRows > 0 && totalErrorRows === 0 && (
                <Button variant="primary" size="sm" onClick={handleCommitImport} loading={isCommitting}>
                  <CheckCircle2 className="h-4 w-4" />
                  Import {totalValidRows} Valid Record{totalValidRows !== 1 ? 's' : ''}
                </Button>
              )}
              {totalErrorRows > 0 && <p className="text-status-error-text max-w-sm text-right text-xs">Resolve every validation error before importing. No partial records will be created.</p>}
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
              Successfully imported {importResult?.createdRows ?? totalValidRows} employee records.
              {importResult?.generatedNumbers ? ` ${importResult.generatedNumbers} employee numbers were generated safely.` : ''}
              {importResult?.driversCreated ? ` ${importResult.driversCreated} incomplete driver profiles now require licence verification.` : ''}
              {reviewedSkippedRows > 0 ? ` ${reviewedSkippedRows} reviewed row${reviewedSkippedRows === 1 ? '' : 's'} were skipped.` : ''}
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
