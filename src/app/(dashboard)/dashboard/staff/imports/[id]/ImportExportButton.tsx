'use client';

import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

interface ImportExportButtonProps {
  batchFileName: string;
  rows: Array<{
    rowNumber: number;
    rawData: Record<string, unknown>;
    isCommitted: boolean;
    validationErrors: string[] | null;
  }>;
}

function exportCsv(
  fileName: string,
  rows: ImportExportButtonProps['rows'],
) {
  const allKeys = new Set<string>();
  for (const row of rows) {
    if (row.rawData && typeof row.rawData === 'object') {
      Object.keys(row.rawData as Record<string, unknown>).forEach((k) => allKeys.add(k));
    }
  }
  const headers = ['rowNumber', 'status', ...Array.from(allKeys), 'validationErrors'];

  const csvRows = [headers.join(',')];
  for (const row of rows) {
    const status = row.isCommitted ? 'committed' : (row.validationErrors?.length ? 'failed' : 'pending');
    const values = headers.map((h) => {
      if (h === 'rowNumber') return String(row.rowNumber);
      if (h === 'status') return status;
      if (h === 'validationErrors') return (row.validationErrors || []).join('; ');
      const raw = row.rawData as Record<string, unknown>;
      const val = raw?.[h];
      if (val == null) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    });
    csvRows.push(values.join(','));
  }

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.replace(/\.[^.]+$/, '') + '-export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportExportButton({ batchFileName, rows }: ImportExportButtonProps) {
  return (
    <Button variant="secondary" size="sm" onClick={() => exportCsv(batchFileName, rows)}>
      <Download className="h-4 w-4" /> Export CSV
    </Button>
  );
}
