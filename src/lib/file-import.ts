/**
 * File Import Utility
 *
 * Unified parser for CSV (via PapaParse) and XLSX (via SheetJS) files.
 * Returns a common { headers, rows, sheetNames } format used by
 * the staff and vehicle import wizards.
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedImport {
  headers: string[];
  rows: Record<string, string>[];
  sheetNames: string[];
  /** The actual sheet name used if XLSX, or 'CSV' for CSV files */
  sourceSheet: string;
}

/**
 * Parse a file into headers and row arrays.
 * Auto-detects CSV vs XLSX by extension.
 */
export function parseImportFile(file: File): Promise<ParsedImport> {
  return new Promise((resolve, reject) => {
    const isExcel = /\.xlsx?$/i.test(file.name);

    if (isExcel) {
      // ----- XLSX via SheetJS -----
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const sheetNames = workbook.SheetNames;

          if (sheetNames.length === 0) {
            reject(new Error('Excel file contains no sheets'));
            return;
          }

          // Use the first sheet by default
          const sheetName = sheetNames[0];
          const worksheet = workbook.Sheets[sheetName];

          // Convert to array-of-arrays first to get raw headers
          const aoa: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '',
            blankrows: false,
          });

          if (aoa.length < 1) {
            reject(new Error('No data found in the selected sheet'));
            return;
          }

          const headers = (aoa[0] as string[]).map((h: string) => String(h).trim());
          const rows: Record<string, string>[] = [];

          for (let i = 1; i < aoa.length; i++) {
            const values = aoa[i] as string[];
            const rowData: Record<string, string> = {};
            headers.forEach((h, idx) => {
              rowData[h] = values[idx] !== undefined ? String(values[idx]).trim() : '';
            });
            // Skip completely empty rows
            if (Object.values(rowData).every((v) => !v)) continue;
            rows.push(rowData);
          }

          resolve({
            headers,
            rows,
            sheetNames,
            sourceSheet: sheetName,
          });
        } catch (err) {
          reject(new Error(`Failed to parse Excel file: ${err instanceof Error ? err.message : String(err)}`));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    } else {
      // ----- CSV via PapaParse -----
      Papa.parse<string[]>(file, {
        header: false,
        skipEmptyLines: true,
        complete: (result) => {
          if (result.data.length < 1) {
            reject(new Error('No data found in the CSV file'));
            return;
          }

          const headers = result.data[0].map((h: string) => String(h).trim());
          const rows: Record<string, string>[] = [];

          for (let i = 1; i < result.data.length; i++) {
            const values = result.data[i];
            const rowData: Record<string, string> = {};
            headers.forEach((h, idx) => {
              rowData[h] = values[idx] !== undefined ? String(values[idx]).trim() : '';
            });
            if (Object.values(rowData).every((v) => !v)) continue;
            rows.push(rowData);
          }

          resolve({
            headers,
            rows,
            sheetNames: ['CSV'],
            sourceSheet: 'CSV',
          });
        },
        error: (err) => reject(new Error(`CSV parse error: ${err.message}`)),
      });
    }
  });
}
