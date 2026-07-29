import { documentTypeLabel, formatHumanValue, humanizeKey } from '@/lib/human-readable';

const INTERNAL_FIELDS = new Set([
  'id',
  'tenantId',
  'requestId',
  'tripId',
  'documentId',
  'employeeId',
  'vehicleId',
  'driverId',
  'allocationId',
  'userId',
  'createdByUserId',
  'generatedByUserId',
]);

function isDisplayField(key: string) {
  return !INTERNAL_FIELDS.has(key);
}

function HumanValue({ name, value }: { name: string; value: unknown }) {
  if (Array.isArray(value)) {
    if (!value.length) return <p className="text-xs text-slate-500">No records</p>;
    const objectRows = value.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
    );
    if (objectRows.length === value.length) {
      const columns = Array.from(
        new Set(objectRows.flatMap((item) => Object.keys(item).filter(isDisplayField))),
      ).slice(0, 6);
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-slate-600">
                {columns.map((column) => (
                  <th key={column} className="px-2 py-1.5 font-semibold">
                    {humanizeKey(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {objectRows.map((row, index) => (
                <tr
                  key={index}
                  className="break-inside-avoid border-b border-slate-200 last:border-0"
                >
                  {columns.map((column) => (
                    <td key={column} className="px-2 py-1.5 align-top text-slate-800">
                      {formatHumanValue(row[column], column)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <p className="text-xs text-slate-800">{value.map(String).join(', ')}</p>;
  }

  if (value && typeof value === 'object') {
    return (
      <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
        {Object.entries(value as Record<string, unknown>)
          .filter(([key]) => isDisplayField(key))
          .map(([key, nestedValue]) => (
            <div
              key={key}
              className="grid grid-cols-[8rem_1fr] gap-2 border-b border-slate-200 py-1.5"
            >
              <span className="text-[11px] font-medium text-slate-500">{humanizeKey(key)}</span>
              <span className="text-xs text-slate-900">{formatHumanValue(nestedValue, key)}</span>
            </div>
          ))}
      </div>
    );
  }

  return <span className="text-xs text-slate-900">{formatHumanValue(value, name)}</span>;
}

export function DocumentContent({
  documentType,
  data,
}: {
  documentType: string;
  data: Record<string, unknown>;
}) {
  const scalarEntries = Object.entries(data).filter(
    ([key, value]) =>
      isDisplayField(key) && !Array.isArray(value) && !(value && typeof value === 'object'),
  );
  const structuredEntries = Object.entries(data).filter(
    ([key, value]) =>
      isDisplayField(key) && (Array.isArray(value) || Boolean(value && typeof value === 'object')),
  );

  return (
    <div className="space-y-5" data-testid="human-readable-document">
      {scalarEntries.length > 0 && (
        <section>
          <h3 className="border-b border-slate-300 pb-1 text-xs font-bold tracking-wide text-[#1F2A44] uppercase">
            {documentTypeLabel(documentType)} Details
          </h3>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {scalarEntries.map(([key, value]) => (
              <div
                key={key}
                className="grid grid-cols-[8.5rem_1fr] gap-2 border-b border-slate-200 py-1.5"
              >
                <span className="text-[11px] font-medium text-slate-500">{humanizeKey(key)}</span>
                <HumanValue name={key} value={value} />
              </div>
            ))}
          </div>
        </section>
      )}
      {structuredEntries.map(([key, value]) => (
        <section key={key}>
          <h3 className="mb-1.5 border-b border-slate-300 pb-1 text-xs font-bold tracking-wide text-[#1F2A44] uppercase">
            {humanizeKey(key)}
          </h3>
          <HumanValue name={key} value={value} />
        </section>
      ))}
    </div>
  );
}
