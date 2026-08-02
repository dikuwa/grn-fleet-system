'use client';

import { useState, useRef, useCallback } from 'react';
import { parseImportFile } from '@/lib/file-import';
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
  FileSpreadsheet,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import Link from 'next/link';
import {
  MobileActionBar,
  ResponsiveStatsGrid,
  ResponsiveStepper,
  ResponsiveTable,
  ResponsiveUploadZone,
} from '@/components/ui/responsive';

type Step = 'upload' | 'mapping' | 'preview' | 'committing' | 'complete';

interface ImportRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
  isDuplicate: boolean;
}

const VEHICLE_TEMPLATE_COLUMNS = [
  { key: 'licence_number', label: 'Licence Number', required: true },
  { key: 'vehicle_register_number', label: 'Register Number', required: false },
  { key: 'vin', label: 'VIN', required: false },
  { key: 'engine_number', label: 'Engine Number', required: false },
  { key: 'make', label: 'Make', required: true },
  { key: 'model', label: 'Model', required: true },
  { key: 'series_name', label: 'Series Name', required: false },
  { key: 'manufacture_year', label: 'Manufacture Year', required: false },
  { key: 'colour', label: 'Colour', required: false },
  { key: 'fuel_type', label: 'Fuel Type', required: false },
  { key: 'transmission', label: 'Transmission', required: false },
  { key: 'vehicle_category', label: 'Vehicle Category', required: false },
  { key: 'vehicle_description', label: 'Description', required: false },
  { key: 'tare_kg', label: 'Tare Weight (kg)', required: false },
  { key: 'gross_vehicle_mass_kg', label: 'Gross Mass (kg)', required: false },
  { key: 'seated_capacity', label: 'Seated Capacity', required: false },
  { key: 'standing_capacity', label: 'Standing Capacity', required: false },
  { key: 'status', label: 'Status', required: false },
  { key: 'current_odometer', label: 'Current Odometer (km)', required: false },
  { key: 'notes', label: 'Notes', required: false },
] as const;

export default function VehicleImportPage() {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string>('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [currentPreviewPage, setCurrentPreviewPage] = useState(1);
  const [isCommitting, setIsCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewPageSize = 10;

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setFileName(file.name);

      parseImportFile(file)
        .then((parsed) => {
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
          for (const col of VEHICLE_TEMPLATE_COLUMNS) {
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
            for (const col of VEHICLE_TEMPLATE_COLUMNS) {
              if (!col.required) continue;
              const mappedKey = Object.entries(mapping).find(([, v]) => v === col.key)?.[0];
              if (!mappedKey || !row.data[mappedKey]?.trim()) {
                errors.push(`Missing required field: ${col.label}`);
              }
            }
            return { ...row, errors };
          });
          setRows(validated);

          setStep('mapping');
        })
        .catch((err) => {
          toast({ title: 'Parse Error', description: err.message, variant: 'error' });
        });
    },
    [toast],
  );

  const totalValidRows = rows.filter((r) => r.errors.length === 0).length;

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

      const res = await fetch('/api/fleet/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payload }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Import failed');
      }

      toast({
        title: 'Import complete',
        description: `${totalValidRows} vehicle(s) imported successfully`,
        variant: 'success',
      });
      setStep('complete');
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'An error occurred during import',
        variant: 'error',
      });
      setStep('preview');
    } finally {
      setIsCommitting(false);
    }
  }, [rows, columnMapping, toast, totalValidRows]);

  const totalErrorRows = rows.filter((r) => r.errors.length > 0).length;
  const previewRows = rows.slice(
    (currentPreviewPage - 1) * previewPageSize,
    currentPreviewPage * previewPageSize,
  );
  const previewTotalPages = Math.ceil(rows.length / previewPageSize);

  const allHeaders = rows.length > 0 ? Object.keys(rows[0].data) : [];
  const unmappedColumns = allHeaders.filter((h) => !columnMapping[h]);
  const importSteps = [
    { label: 'Upload' },
    { label: 'Column Mapping' },
    { label: 'Review & Confirm' },
    { label: 'Complete' },
  ] as const;
  const currentStepIndex =
    step === 'upload' ? 0 : step === 'mapping' ? 1 : step === 'complete' ? 3 : 2;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fleet', href: '/dashboard/fleet' },
          { label: 'Import Vehicles' },
        ]}
      />
      <PageHeader
        title="Import Vehicles"
        description="Upload a CSV file to import or update vehicle records in bulk"
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/fleet">
            <ChevronLeft className="h-4 w-4" />
            Back to Fleet
          </Link>
        </Button>
        <Button variant="tertiary" size="sm" asChild>
          <a href="/vehicle-import-template.csv" download>
            <Download className="h-4 w-4" />
            Download Template
          </a>
        </Button>
      </PageHeader>

      {/* Step indicator */}
      <ResponsiveStepper steps={importSteps} current={currentStepIndex} />

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <Card>
          <CardContent className="pt-6">
            <ResponsiveUploadZone className="bg-canvas hover:border-brand-300 transition-colors">
              <label
                htmlFor="vehicle-import-file"
                className="flex cursor-pointer flex-col items-center justify-center"
              >
                <div className="bg-brand-50 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <Upload className="text-brand-700 h-8 w-8" />
                </div>
                <h3 className="text-ink-950 text-base font-semibold">Upload File</h3>
                <p className="text-ink-500 mt-1 max-w-sm text-sm">
                  Drag and drop your CSV or Excel file here, or click to browse. The file should
                  contain vehicle data with column headers.
                </p>
                <div className="text-ink-500 mt-6 flex flex-wrap items-center justify-center gap-2 text-xs sm:gap-4">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Supported: .csv, .xlsx</span>
                  <span className="text-ink-300">|</span>
                  <span>Max: 10MB</span>
                  <span className="text-ink-300">|</span>
                  <span>Template available</span>
                </div>
                <input
                  id="vehicle-import-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </label>
            </ResponsiveUploadZone>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Column Mapping */}
      {step === 'mapping' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Column Mapping</CardTitle>
            </CardHeader>
            <CardContent>
              {unmappedColumns.length > 0 && (
                <div className="bg-status-pending-bg text-status-pending-text mb-4 flex items-center gap-2 rounded-[8px] px-3 py-2 text-xs font-medium">
                  <AlertCircle className="h-4 w-4" />
                  {unmappedColumns.length} column{unmappedColumns.length !== 1 ? 's' : ''} not
                  mapped: {unmappedColumns.slice(0, 3).join(', ')}
                  {unmappedColumns.length > 3 && ` +${unmappedColumns.length - 3} more`}
                </div>
              )}
              <ResponsiveTable label="Vehicle import column mapping">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-border border-b">
                      <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">
                        CSV Column
                      </th>
                      <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">
                        Maps To
                      </th>
                      <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">
                        Required
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {VEHICLE_TEMPLATE_COLUMNS.map((col) => {
                      const mappedFrom = Object.entries(columnMapping).find(
                        ([, v]) => v === col.key,
                      )?.[0];
                      return (
                        <tr key={col.key} className="hover:bg-canvas/50">
                          <td className="text-ink-700 px-3 py-2">
                            {mappedFrom || <span className="text-ink-400 italic">Not mapped</span>}
                          </td>
                          <td className="px-3 py-2">
                            <span className="bg-muted text-ink-700 rounded px-2 py-0.5 font-mono text-xs">
                              {col.key}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {col.required ? (
                              <StatusBadge status="error" label="Required" />
                            ) : (
                              <span className="text-ink-500 text-xs">Optional</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ResponsiveTable>
            </CardContent>
          </Card>
          <MobileActionBar>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setStep('preview')}
              disabled={rows.length === 0}
            >
              Continue to Preview <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setStep('upload')}>
              Back
            </Button>
          </MobileActionBar>
        </div>
      )}

      {/* Step 3: Preview & Confirm */}
      {step === 'preview' && (
        <div className="space-y-6">
          <ResponsiveStatsGrid className="sm:grid-cols-3">
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-ink-950 text-2xl font-[650] tabular-nums">{rows.length}</p>
                  <p className="text-ink-500 text-xs">Total Rows</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-status-success-text text-2xl font-[650] tabular-nums">
                    {totalValidRows}
                  </p>
                  <p className="text-ink-500 text-xs">Valid</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-status-error-text text-2xl font-[650] tabular-nums">
                    {totalErrorRows}
                  </p>
                  <p className="text-ink-500 text-xs">Errors</p>
                </div>
              </CardContent>
            </Card>
          </ResponsiveStatsGrid>

          <Card>
            <CardHeader>
              <CardTitle>Data Preview</CardTitle>
              <span className="text-ink-500 text-xs">
                Page {currentPreviewPage} of {previewTotalPages}
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <ResponsiveTable label="Vehicle import preview">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-border bg-muted border-b">
                      <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">#</th>
                      <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">
                        Licence #
                      </th>
                      <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">
                        Make / Model
                      </th>
                      <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">Year</th>
                      <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">
                        Colour
                      </th>
                      <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">
                        Odometer
                      </th>
                      <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {previewRows.map((row) => {
                      const licence =
                        row.data[
                          Object.entries(columnMapping).find(
                            ([, v]) => v === 'licence_number',
                          )?.[0] || ''
                        ];
                      const make =
                        row.data[
                          Object.entries(columnMapping).find(([, v]) => v === 'make')?.[0] || ''
                        ];
                      const model =
                        row.data[
                          Object.entries(columnMapping).find(([, v]) => v === 'model')?.[0] || ''
                        ];
                      const year =
                        row.data[
                          Object.entries(columnMapping).find(
                            ([, v]) => v === 'manufacture_year',
                          )?.[0] || ''
                        ];
                      const colour =
                        row.data[
                          Object.entries(columnMapping).find(([, v]) => v === 'colour')?.[0] || ''
                        ];
                      const odometer =
                        row.data[
                          Object.entries(columnMapping).find(
                            ([, v]) => v === 'current_odometer',
                          )?.[0] || ''
                        ];

                      return (
                        <tr
                          key={row.rowNumber}
                          className={`hover:bg-canvas/50 transition-colors ${
                            row.errors.length > 0 ? 'bg-status-error-bg/30' : ''
                          }`}
                        >
                          <td className="text-ink-500 px-3 py-2 text-xs">{row.rowNumber}</td>
                          <td className="text-ink-700 px-3 py-2 text-xs tabular-nums">
                            {licence || '—'}
                          </td>
                          <td className="text-ink-700 px-3 py-2 text-sm">
                            {make} {model}
                          </td>
                          <td className="text-ink-500 px-3 py-2 text-sm">{year || '—'}</td>
                          <td className="text-ink-500 px-3 py-2 text-sm">{colour || '—'}</td>
                          <td className="text-ink-500 px-3 py-2 text-xs tabular-nums">
                            {odometer ? `${Number(odometer).toLocaleString()} km` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {row.errors.length > 0 ? (
                              <div className="flex items-center gap-1">
                                <XCircle className="text-status-error-text h-3.5 w-3.5" />
                                <span className="text-status-error-text text-xs">
                                  {row.errors.length} error{row.errors.length !== 1 ? 's' : ''}
                                </span>
                              </div>
                            ) : (
                              <CheckCircle2 className="text-status-success-text h-3.5 w-3.5" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ResponsiveTable>

              {previewTotalPages > 1 && (
                <div className="border-border flex items-center justify-between border-t px-4 py-3">
                  <p className="text-ink-500 text-xs">
                    Showing {(currentPreviewPage - 1) * previewPageSize + 1}–
                    {Math.min(currentPreviewPage * previewPageSize, rows.length)} of {rows.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      className="border-border text-ink-500 hover:bg-muted h-8 rounded-[6px] border px-3 text-xs transition-colors disabled:opacity-50"
                      disabled={currentPreviewPage <= 1}
                      onClick={() => setCurrentPreviewPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <button
                      className="border-border text-ink-500 hover:bg-muted h-8 rounded-[6px] border px-3 text-xs transition-colors disabled:opacity-50"
                      disabled={currentPreviewPage >= previewTotalPages}
                      onClick={() =>
                        setCurrentPreviewPage((p) => Math.min(previewTotalPages, p + 1))
                      }
                    >
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {totalErrorRows > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Validation Errors</CardTitle>
                <StatusBadge status="error" label={`${totalErrorRows} rows affected`} />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {rows
                    .filter((r) => r.errors.length > 0)
                    .slice(0, 5)
                    .map((row) => (
                      <div
                        key={row.rowNumber}
                        className="border-status-error-bg bg-status-error-bg/30 rounded-[8px] border p-3"
                      >
                        <p className="text-status-error-text text-xs font-medium">
                          Row {row.rowNumber}
                        </p>
                        <ul className="text-status-error-text/80 mt-1 list-inside list-disc text-xs">
                          {row.errors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  {totalErrorRows > 5 && (
                    <p className="text-ink-500 text-xs">
                      ...and {totalErrorRows - 5} more rows with errors
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between">
            <p className="text-ink-500 text-xs">
              {fileName} · {totalValidRows} valid, {totalErrorRows} with errors
            </p>
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => setStep('mapping')}>
                Back
              </Button>
              {totalValidRows > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCommitImport}
                  loading={isCommitting}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Import {totalValidRows} Vehicle{totalValidRows !== 1 ? 's' : ''}
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
              <div className="bg-brand-50 flex h-16 w-16 items-center justify-center rounded-full">
                <div className="border-brand-700 h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
              </div>
            </div>
            <h3 className="text-ink-950 text-lg font-semibold">Importing Vehicles...</h3>
            <p className="text-ink-500 mt-1 text-sm">
              Validating and inserting vehicle records into the database.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Complete */}
      {step === 'complete' && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mb-4 flex items-center justify-center">
              <div className="bg-status-success-bg flex h-16 w-16 items-center justify-center rounded-full">
                <CheckCircle2 className="text-status-success-text h-8 w-8" />
              </div>
            </div>
            <h3 className="text-ink-950 text-lg font-semibold">Import Complete</h3>
            <p className="text-ink-500 mt-1 text-sm">
              Successfully imported {totalValidRows} vehicle records.
              {totalErrorRows > 0 && ` ${totalErrorRows} rows had errors and were skipped.`}
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="secondary" size="sm" asChild>
                <Link href="/dashboard/fleet/import">Import Another File</Link>
              </Button>
              <Button variant="primary" size="sm" asChild>
                <Link href="/dashboard/fleet">View Fleet</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
