import { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, AlertCircle, RefreshCw } from 'lucide-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface RequestOption {
  id: string;
  reference: string;
  purpose: string | null;
  status: string;
  requester: {
    firstName: string;
    lastName: string;
    employeeNumber: string;
  };
  route: {
    origin: string | null;
    destination: string | null;
  };
  dates: {
    start: string | null; // ISO string
    end: string | null; // ISO string
  };
  passengerCount: number;
  allocationStatus: string; // 'Allocated' or 'Not allocated'
  label: string;
}

interface RequestSelectorProps {
  label?: string;
  placeholder?: string;
  onChange: (selected: RequestOption) => void;
  // Optional: pre-selected value (id)
  defaultValue?: string;
  // Optional: limit the number of items per page
  pageSize?: number;
}

export function RequestSelector({
  label = 'Search request',
  placeholder = 'Search reference, requester, purpose...',
  onChange,
  defaultValue,
  pageSize = 25,
}: RequestSelectorProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [options, setOptions] = useState<RequestOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(defaultValue || null);
  const [selectedOption, setSelectedOption] = useState<RequestOption | null>(null);

  // Fetch options from the API
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
        const res = await fetch(`/api/requests-search?${params}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch: ${res.statusText}`);
        }
        const data = await res.json();
        setOptions(data.data);
        setTotalPages(data.pagination.totalPages);
      } catch (err) {
        console.error('RequestSelector fetch error:', err);
        setError('Failed to load options. Please try again.');
        setOptions([]);
      } finally {
        setLoading(false);
      }
    },
    [pageSize]
  );

  // Load initial options (empty query) on mount and when pageSize changes
  useEffect(() => {
    if (!query) {
      fetchOptions('', 1);
    }
  }, [query, fetchOptions]);

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
  const handleSelect = (option: RequestOption) => {
    setSelectedId(option.id);
    setSelectedOption(option);
    onChange(option);
  };

  // We need to call onChange with the current selected option
  // We'll use a ref to keep the latest onChange callback to avoid stale closure issues
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // If we have a default value, we could try to fetch it to set the selectedOption, 
  // but for simplicity we'll just set the selectedId and leave the selectedOption as null until the user interacts.
  // Alternatively, we could fetch the option by id when the defaultValue changes, but we skip for now.

  // Render the selected item as a single value (since this is a single select)
  const renderSelected = () => {
    if (!selectedOption) return null;
    return (
      <div className="flex items-center space-x-2 text-sm">
        <div className="font-medium">{selectedOption.reference}</div>
        <div className="text-muted-foreground">
          {selectedOption.requester.firstName} {selectedOption.requester.lastName}
        </div>
      </div>
    );
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
                ${selectedId === opt.id ? 'bg-primary/10' : ''}
              `}
              onClick={() => {
                setSelectedId(opt.id);
                setSelectedOption(opt);
                onChange(opt);
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium">{opt.reference}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {opt.requester.firstName} {opt.requester.lastName} ({opt.requester.employeeNumber})
                </div>
                {opt.purpose && (
                  <div className="text-xs text-muted-foreground truncate">
                    {opt.purpose}
                  </div>
                )}
                <div className="text-xs text-muted-foreground truncate">
                  {`${opt.route.origin ?? 'N/A'} → ${opt.route.destination ?? 'N/A'}`}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {`${opt.dates.start ? new Date(opt.dates.start).toLocaleDateString() : 'N/A'} `}
                  {`to ${opt.dates.end ? new Date(opt.dates.end).toLocaleDateString() : 'N/A'}`}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {`Passengers: ${opt.passengerCount}`}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {`Status: ${opt.status}`}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {`Allocation: ${opt.allocationStatus}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {(!loading && options.length === 0 && query === '') && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No requests found
        </div>
      )}
      <div className="flex justify-end mt-2">
        {renderSelected()}
      </div>
    </div>
  );
}