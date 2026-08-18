'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, FileUp, Loader2, Plus, RefreshCw, ShieldCheck, Truck } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VehicleCombobox, type VehicleSearchOption } from '@/components/ui/vehicle-combobox';
import { useToast } from '@/lib/use-toast';

type Provider = {
  id: string;
  providerType: string;
  providerName: string;
  integrationMode: string;
  isDefault: boolean;
  requireForRelease: boolean;
  status: string;
};

type Instrument = {
  id: string;
  providerId: string;
  providerName: string;
  providerType: string;
  instrumentType: string;
  displayName: string | null;
  maskedIdentifier: string;
  vehicleId: string | null;
  vehicleLicence: string | null;
  vehicleRegisterNumber: string | null;
  status: string;
  allowedCategories: string[] | null;
};

type Transaction = {
  id: string;
  providerName: string;
  maskedIdentifier: string | null;
  transactionAt: string;
  merchant: string | null;
  category: string;
  amount: string;
  currency: string;
  reconciliationStatus: string;
  source: string;
};

const providerDefaults: Record<string, string> = {
  standard_bank_bluefuel: 'Standard Bank BlueFuel',
  fnb_fleet: 'FNB Fleet',
  other_bank_fleet: 'Other Bank Fleet',
  company_account: 'Company Fleet Account',
  manual: 'Manual / Cash / EFT',
};

export default function FleetPaymentsPage() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [providerType, setProviderType] = useState('standard_bank_bluefuel');
  const [providerName, setProviderName] = useState(providerDefaults.standard_bank_bluefuel);
  const [integrationMode, setIntegrationMode] = useState('manual');
  const [providerDefault, setProviderDefault] = useState(true);

  const [instrumentProviderId, setInstrumentProviderId] = useState('');
  const [instrumentType, setInstrumentType] = useState('vehicle_tag');
  const [identifier, setIdentifier] = useState('');
  const [vehicle, setVehicle] = useState<VehicleSearchOption | null>(null);

  const [importProviderId, setImportProviderId] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [providersResponse, instrumentsResponse, transactionsResponse] = await Promise.all([
        fetch('/api/fleet-payments/providers', { cache: 'no-store' }),
        fetch('/api/fleet-payments/instruments', { cache: 'no-store' }),
        fetch('/api/fleet-payments/transactions?limit=40', { cache: 'no-store' }),
      ]);
      const [providersJson, instrumentsJson, transactionsJson] = await Promise.all([
        providersResponse.json(),
        instrumentsResponse.json(),
        transactionsResponse.json(),
      ]);
      if (!providersResponse.ok) throw new Error(providersJson.error || 'Unable to load fleet payment providers');
      if (!instrumentsResponse.ok) throw new Error(instrumentsJson.error || 'Unable to load fleet payment instruments');
      setProviders(providersJson.data || []);
      setInstruments(instrumentsJson.data || []);
      setTransactions(transactionsResponse.ok ? transactionsJson.data || [] : []);
      const firstProvider = (providersJson.data || [])[0] as Provider | undefined;
      if (firstProvider) {
        setInstrumentProviderId((current) => current || firstProvider.id);
        setImportProviderId((current) => current || firstProvider.id);
      }
    } catch (error) {
      toast({
        title: 'Fleet payments unavailable',
        description: error instanceof Error ? error.message : 'Unable to load fleet payments.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const active = instruments.filter((item) => item.status === 'active').length;
    const assigned = instruments.filter((item) => item.status === 'active' && item.vehicleId).length;
    const attention = instruments.filter((item) => !['active', 'replaced'].includes(item.status)).length;
    return { active, assigned, attention };
  }, [instruments]);

  async function createProvider(event: FormEvent) {
    event.preventDefault();
    setBusy('provider');
    try {
      const response = await fetch('/api/fleet-payments/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerType,
          providerName,
          integrationMode,
          isDefault: providerDefault,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Provider was not saved');
      toast({ title: 'Fleet payment provider added', description: `${providerName} is ready for setup.`, variant: 'success' });
      await load();
    } catch (error) {
      toast({ title: 'Provider not added', description: error instanceof Error ? error.message : 'Try again.', variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function createInstrument(event: FormEvent) {
    event.preventDefault();
    if (!instrumentProviderId || !identifier.trim()) return;
    setBusy('instrument');
    try {
      const response = await fetch('/api/fleet-payments/instruments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: instrumentProviderId,
          instrumentType,
          identifier,
          vehicleId: vehicle?.id || null,
          allowedCategories: ['fuel', 'oil', 'emergency_repair', 'tyre_service', 'other'],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Instrument was not saved');
      setIdentifier('');
      setVehicle(null);
      toast({
        title: 'Fleet payment instrument registered',
        description: vehicle ? `It will auto-assign with ${vehicle.licenceNumber}.` : 'Link a vehicle when the credential is vehicle-specific.',
        variant: 'success',
      });
      await load();
    } catch (error) {
      toast({ title: 'Instrument not registered', description: error instanceof Error ? error.message : 'Try again.', variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function importStatement(event: FormEvent) {
    event.preventDefault();
    if (!importProviderId || !importFile) return;
    setBusy('import');
    setImportResult(null);
    try {
      const form = new FormData();
      form.set('providerId', importProviderId);
      form.set('file', importFile);
      const response = await fetch('/api/fleet-payments/import', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Statement import failed');
      const data = result.data;
      setImportResult(
        `${data.imported} imported · ${data.matched} matched · ${data.likely_match} likely · ${data.unmatched} unmatched`,
      );
      setImportFile(null);
      toast({ title: 'Statement imported', description: 'Transactions were reconciled against fleet records.', variant: 'success' });
      await load();
    } catch (error) {
      toast({ title: 'Import failed', description: error instanceof Error ? error.message : 'Try another statement.', variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        title="Fleet Payments"
        description="Track BlueFuel and other fleet payment credentials without replacing the bank/payment provider. Vehicle-linked instruments are assigned automatically with trips."
      >
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-ink-500 text-xs">Active instruments</p><p className="text-ink-950 mt-1 text-2xl font-semibold">{stats.active}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-ink-500 text-xs">Vehicle-linked</p><p className="text-ink-950 mt-1 text-2xl font-semibold">{stats.assigned}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-ink-500 text-xs">Needs attention</p><p className="text-ink-950 mt-1 text-2xl font-semibold">{stats.attention}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Providers</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {providers.length ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {providers.map((provider) => (
                <div key={provider.id} className="border-border flex items-center justify-between gap-3 rounded-[8px] border p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-ink-950 truncate text-sm font-semibold">{provider.providerName}</p>
                      {provider.isDefault && <Badge variant="success">Default</Badge>}
                    </div>
                    <p className="text-ink-500 mt-1 text-xs">
                      {provider.integrationMode.replaceAll('_', ' ')} · {provider.status}
                    </p>
                  </div>
                  <ShieldCheck className="text-brand-700 h-5 w-5 shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-ink-500 text-sm">No provider configured. GRN/KERC can use Standard Bank BlueFuel; other tenants may choose their own provider.</p>
          )}

          <details className="border-border rounded-[8px] border p-3">
            <summary className="text-ink-900 cursor-pointer text-sm font-medium">Add another provider</summary>
            <form onSubmit={createProvider} className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Provider type</Label>
                <Select value={providerType} onValueChange={(value) => { setProviderType(value); setProviderName(providerDefaults[value] || 'Fleet Payment Provider'); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard_bank_bluefuel">Standard Bank BlueFuel</SelectItem>
                    <SelectItem value="fnb_fleet">FNB Fleet</SelectItem>
                    <SelectItem value="other_bank_fleet">Other bank fleet</SelectItem>
                    <SelectItem value="company_account">Company account</SelectItem>
                    <SelectItem value="manual">Manual / cash / EFT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="provider-name">Display name</Label><Input id="provider-name" value={providerName} onChange={(event) => setProviderName(event.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Integration</Label>
                <Select value={integrationMode} onValueChange={setIntegrationMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="file_import">CSV / Excel import</SelectItem>
                    <SelectItem value="api">API (after provider contract)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Checkbox id="provider-default" checked={providerDefault} onCheckedChange={(value) => setProviderDefault(value === true)} />
                <Label htmlFor="provider-default">Use as tenant default</Label>
              </div>
              <div className="md:col-span-2"><Button type="submit" loading={busy === 'provider'}><Plus className="h-4 w-4" /> Add provider</Button></div>
            </form>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payment instruments</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={createInstrument} className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-1.5"><Label>Provider</Label><Select value={instrumentProviderId} onValueChange={setInstrumentProviderId}><SelectTrigger><SelectValue placeholder="Choose provider" /></SelectTrigger><SelectContent>{providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.providerName}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Type</Label><Select value={instrumentType} onValueChange={setInstrumentType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="vehicle_tag">Vehicle tag</SelectItem><SelectItem value="card">Fleet card</SelectItem><SelectItem value="virtual">Virtual</SelectItem><SelectItem value="account">Account</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="instrument-id">Card/tag identifier</Label><Input id="instrument-id" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Enter identifier; only last 4 will be displayed" /></div>
            <div className="space-y-1.5"><Label>Vehicle</Label><VehicleCombobox value={vehicle?.id || ''} selectedOption={vehicle} onSelect={setVehicle} placeholder="Search vehicle (recommended)" /></div>
            <div className="lg:col-span-2"><Button type="submit" disabled={!providers.length || !identifier.trim()} loading={busy === 'instrument'}><CreditCard className="h-4 w-4" /> Register instrument</Button></div>
          </form>

          <div className="space-y-2">
            {loading ? <div className="text-ink-500 flex items-center gap-2 py-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading instruments…</div> : instruments.length === 0 ? <p className="text-ink-500 py-4 text-sm">No instruments yet. Register the existing BlueFuel tag/card against its vehicle; do not create a new bank credential.</p> : instruments.map((instrument) => (
              <div key={instrument.id} className="border-border flex flex-col gap-2 rounded-[8px] border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-ink-950 text-sm font-semibold">{instrument.providerName} · {instrument.maskedIdentifier}</p><p className="text-ink-500 mt-1 text-xs">{instrument.vehicleLicence ? `${instrument.vehicleLicence}${instrument.vehicleRegisterNumber ? ` · ${instrument.vehicleRegisterNumber}` : ''}` : 'Not vehicle-linked'} · {instrument.instrumentType.replaceAll('_', ' ')}</p></div>
                <Badge variant={instrument.status === 'active' ? 'success' : 'warning'}>{instrument.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Import provider statement</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-ink-500 text-sm">Upload the provider export you already use. CSV and Excel are matched against vehicle, trip, instrument, fuel and expense records.</p>
          <form onSubmit={importStatement} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-1.5"><Label>Provider</Label><Select value={importProviderId} onValueChange={setImportProviderId}><SelectTrigger><SelectValue placeholder="Choose provider" /></SelectTrigger><SelectContent>{providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.providerName}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="statement-file">Statement file</Label><Input id="statement-file" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setImportFile(event.target.files?.[0] || null)} /></div>
            <Button type="submit" disabled={!importProviderId || !importFile} loading={busy === 'import'}><FileUp className="h-4 w-4" /> Import</Button>
          </form>
          {importResult && <p className="text-status-success-text text-sm font-medium">{importResult}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent provider transactions</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {transactions.length === 0 ? <p className="text-ink-500 py-4 text-sm">No provider transactions recorded yet.</p> : transactions.map((transaction) => (
            <div key={transaction.id} className="border-border grid gap-2 rounded-[8px] border p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_auto] sm:items-center">
              <div><p className="text-ink-950 text-sm font-medium">{transaction.merchant || transaction.providerName}</p><p className="text-ink-500 mt-1 text-xs">{new Date(transaction.transactionAt).toLocaleString('en-NA')} · {transaction.category.replaceAll('_', ' ')}{transaction.maskedIdentifier ? ` · ${transaction.maskedIdentifier}` : ''}</p></div>
              <p className="text-ink-950 text-sm font-semibold">{transaction.currency} {Number(transaction.amount).toFixed(2)}</p>
              <Badge variant={transaction.reconciliationStatus === 'matched' ? 'success' : transaction.reconciliationStatus === 'likely_match' ? 'info' : 'warning'}>{transaction.reconciliationStatus.replaceAll('_', ' ')}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="border-brand-200 bg-brand-50/40 text-ink-700 dark:border-brand-900 dark:bg-brand-950/20 flex gap-3 rounded-[8px] border p-4 text-sm">
        <Truck className="text-brand-700 h-5 w-5 shrink-0" />
        <p>Vehicle-linked instruments are selected automatically during allocation. Drivers continue using the bank/provider process normally; GRN FLEET stores only the operational association and masked identifier.</p>
      </div>
    </div>
  );
}
