import { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, AlertCircle, RefreshCw } from 'lucide-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface VehicleOption {
  id: string;
  licenceNumber: string;
  vehicleRegisterNumber: string | null;
  make: string;
  model: string;
  year: number | null;
  categoryName: string | null;
  categoryCode: string | null;
  status: string;
  currentOdometer: number;
  fuelType: string;
  requiredLicenceClass: string | null;
  professionalAuthorisationRequired: boolean;
  seatedCapacity: number | null;
  standingCapacity: number | null;
  label: string;
}

interface VehicleSelectorProps {
  label?: string;
  placeholder?: string;
  multiple?: boolean;
  onChange: (selected: VehicleOption[]) => void;
  defaultValue?: string[];
  pageSize?: number;
  // Optional: filter by status (e.g., only 'available' vehicles)
  statusFilter?: string;
}

export function VehicleSelector({
  label = 'Search vehicle',
  placeholder = 'Search licence number, make, model...',
  multiple = false,
  onChange,
  defaultValue,
  pageSize = 25,
  statusFilter,
}: VehicleSelectorProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [options, setOptions] = useState<VehicleOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultValue || []);
  const [selectedOptions, setSelectedOptions] = useState<VehicleOption[]>([]);

  const fetchOptions = useCallback(
    async (q: string, pageNum: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          q: q,
          page: String(pageNum),
          limit: String(pageSize),
        });
        if (statusFilter) {
          params.set('status', statusFilter);
        }
        const res = await fetch(`/api/vehicle-search?${params}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch: ${await res.text()}`);
        }
        const data = await res.json();
        setOptions(data.data);
        setTotalPages(data.pagination.totalPages);
      } catch (err) {
        console.error('VehicleSelector fetch error:', err);
        setError('Failed to load vehicles. Please try again.');
        setOptions([]);
      } finally {
        setLoading(false);
      }
    },
    [pageSize, statusFilter]
  );

  // Load initial options (empty query) on mount and when pageSize or statusFilter changes
  useEffect(() => {
    if (!query) {
      fetchOptions('', 1);
    }
  }, [query, fetchOptions, statusFilter]);

  // When query changes, reset to page 1 and fetch
  useEffect(() => {
    if (query) {
      setPage(1);
      fetchOptions(query, 1);
    }
  }, [query, fetchOptions]);

  // When page changes, fetch the next page
  useEffect(() => {
    if (!loading) {
      fetchOptions(query, page);
    }
  }, [page, query, loading, fetchOptions]);

  // Handle selection change
  const handleSelect = (option: VehicleOption) => {
    if (multiple) {
      if (selectedIds.includes(option.id)) {
        setSelectedIds(selectedIds.filter((id) => id !== option.id));
        setSelectedOptions(selectedOptions.filter((opt) => opt.id !== option.id));
      } else {
        setSelectedIds([...selectedIds, option.id]);
        setSelectedOptions([...selectedOptions, option]);
      }
    } else {
      setSelectedIds([option.id]);
      setSelectedOptions([option]);
    }
    onCallBack(selectedOptions);
  };

  // We need to call onChange with the current selected options
  // We'll use a ref to keep the latest onChange callback to avoid stale closure issues
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const onCallBack = (selected: VehicleOption[]) => {
    onChangeRef.current(selected);
  };

  // Render the selected items as chips (for multiple) or a single value (for single)
  const renderSelected = () => {
    if (multiple) {
      return selectedOptions.map((opt) => (
        <div key={opt.id} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
          {opt.label}
          <button
            type="button"
            className="ml-2 h-3 w-3 shrink-0 rounded-full text-primary/60 hover:text-primary"
            onClick={() => {
              setSelectedIds(selectedIds.filter((id) => id !== opt.id));
              setSelectedOptions(selectedOptions.filter((o) => o.id !== opt.id));
              onCallBack(selectedOptions.filter((o) => o.id !== opt.id));
            }}
            aria-label={`Remove ${opt.licenceNumber}`}
          >
            &times;
          </button>
        </div>
      ));
    } else {
      if (selectedOptions.length === 0) return null;
      const opt = selectedOptions[0];
      return (
        <div className="flex items-center space-x-2">
          <div className="text-xs font-medium">{opt.licenceNumber}</div>
          {opt.make && opt.model && (
            <div className="text-xs text-muted-foreground">{`${opt.make} ${opt.model}`}</div>
          )}
        </div>
      );
    }
  };

  return (
    <div className="space-y-2">
      {label && <label className="text-xs font-medium text-muted-foreground">{label}</label>}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground">
          <Search />
        </div>
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // Trigger search on enter
            }
          }}
          className={`
            pl-9 pr-3 h-10 w-full rounded-md border border-input bg-background
            text-sm focus:ring-primary focus:border-primary
            disabled:cursor-not-allowed disabled:opacity-50
          `}
        />
        {!loading && options.length === 0 && query !== '' && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground">
            <AlertCircle />
          </div>
        )}
        {loading && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin">
            <Loader2 />
          </div>
        )}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {!loading && (
            <>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                className="h-8 w-8 p-0 rounded-md border border-transparent bg-muted hover:bg-muted/80"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                className="h-8 w-8 p-0 rounded-md border border-transparent bg-muted hover:bg-muted/80"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <div className="text-sm text-destructive">
          {error}
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setPage(1);
            }}
            className="ml-2 h-8 w-8 p-0 rounded-md border border-transparent bg-muted hover:bg-muted/80"
            aria-label="Retry"
          >
            <RefreshCw />
          </button>
        </div>
      )}
      {!loading && options.length > 0 && (
        <div className="max-h-[200px] overflow-y-auto border border-input rounded-md p-2">
          {options.map((opt) => (
            <div
              key={opt.id}
              className={`
                cursor-pointer flex items-start space-x-2 p-2 rounded-md hover:bg-muted
                ${selectedIds.includes(opt.id) ? 'bg-primary/10' : ''}
              `}
              onClick={() => {
                // Prevent closing the dropdown if we are in a multi-select and ctrl/meta is pressed?
                // For simplicity, we just toggle.
                const idx = selectedIds.indexOf(opt.id);
                if (multiple) {
                  if (idx >= 0) {
                    setSelectedIds(selectedIds.filter((id) => id !== opt.id));
                    setSelectedOptions(selectedOptions.filter((o) => o.id !== opt.id));
                  } else {
                    setSelectedIds([...selectedIds, opt.id]);
                    setSelectedOptions([...selectedOptions, opt]);
                  }
                } else {
                  setSelectedIds([opt.id]);
                  setSelectedOptions([opt]);
                }
                onCallBack(selectedOptions);
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium">{opt.licenceNumber}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {opt.make} {opt.model} {opt.year ? `(${opt.year})` : ''}
                </div>
                {opt.categoryName && (
                  <div className="text-xs text-muted-foreground truncate">
                    [{opt.categoryName}]
                  </div>
                )}
                {opt.status !== 'available' && (
                  <div className="text-xs text-muted-foreground truncate">
                    [{opt.status}]
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {(!loading && options.length === 0 && query === '') && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No vehicles found
        </div>
      )}
      <div className="flex justify-end mt-2">
        {renderSelected()}
      </div>
    </div>
  );
}
