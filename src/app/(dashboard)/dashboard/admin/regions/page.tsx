'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, FieldWrapper } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  MapPin, Plus, Loader2, Save, X, CheckCircle2, AlertTriangle,
  Trash2, Edit2, RefreshCw, GripVertical, XCircle,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

interface Region {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

export default function AdminRegionsPage() {
  const { toast } = useToast();
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSortOrder, setFormSortOrder] = useState('0');

  const fetchedRef = useRef(false);

  const fetchRegions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/regions?includeInactive=true');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load regions');
      setRegions(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load regions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchRegions();
  }, [fetchRegions]);

  const openCreateForm = () => {
    setEditingId(null);
    setFormName('');
    setFormCode('');
    setFormDescription('');
    setFormSortOrder('0');
    setShowForm(true);
  };

  const openEditForm = (region: Region) => {
    setEditingId(region.id);
    setFormName(region.name);
    setFormCode(region.code);
    setFormDescription(region.description || '');
    setFormSortOrder(String(region.sortOrder ?? 0));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    setSaving(true);

    try {
      const body = {
        name: formName.trim(),
        code: formCode.trim(),
        description: formDescription.trim() || undefined,
        sortOrder: Number(formSortOrder) || 0,
      };

      const url = editingId
        ? `/api/admin/regions/${editingId}`
        : '/api/admin/regions';
      const method = editingId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save region');

      toast({ title: `Region ${editingId ? 'updated' : 'created'}`, description: formName.trim(), variant: 'success' });
      closeForm();
      fetchRegions();
    } catch (err) {
      toast({ title: 'Failed to save region', description: err instanceof Error ? err.message : 'Failed to save region', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this region? This cannot be undone.')) return;
    setDeleting(id);

    try {
      const res = await fetch(`/api/admin/regions/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to delete region');
      toast({ title: 'Region deleted', description: 'Region removed successfully', variant: 'success' });
      fetchRegions();
    } catch (err) {
      toast({ title: 'Failed to delete region', description: err instanceof Error ? err.message : 'Failed to delete region', variant: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleActive = async (region: Region) => {
    try {
      const res = await fetch(`/api/admin/regions/${region.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !region.isActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update region');
      toast({ title: `Region ${region.isActive ? 'deactivated' : 'activated'}`, description: region.name, variant: 'success' });
      fetchRegions();
    } catch (err) {
      toast({ title: 'Failed to update region', description: err instanceof Error ? err.message : 'Failed to update region', variant: 'error' });
    }
  };

  const activeRegions = regions.filter((r) => r.isActive);
  const inactiveRegions = regions.filter((r) => !r.isActive);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Administration', href: '/dashboard' },
        { label: 'Regions' },
      ]} />
      <PageHeader
        title="Region Management"
        description={`${activeRegions.length} active region${activeRegions.length !== 1 ? 's' : ''}${inactiveRegions.length > 0 ? ` · ${inactiveRegions.length} inactive` : ''}`}
      >
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={fetchRegions}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={openCreateForm}>
            <Plus className="h-4 w-4" /> Add Region
          </Button>
        </div>
      </PageHeader>



      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={closeForm}>
          <div className="mx-4 w-full max-w-md rounded-[12px] border border-border bg-surface p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-ink-950">
                {editingId ? 'Edit Region' : 'Add Region'}
              </h3>
              <button onClick={closeForm} className="text-ink-400 hover:text-ink-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <FieldWrapper label="Region Name" required>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Khomas Region"
                  autoFocus
                />
              </FieldWrapper>
              <FieldWrapper label="Code" required>
                <Input
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                  placeholder="e.g. KH"
                  maxLength={10}
                />
              </FieldWrapper>
              <FieldWrapper label="Description">
                <Input
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </FieldWrapper>
              <FieldWrapper label="Sort Order">
                <Input
                  type="number"
                  value={formSortOrder}
                  onChange={(e) => setFormSortOrder(e.target.value)}
                  placeholder="0"
                  min={0}
                />
              </FieldWrapper>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={closeForm}>Cancel</Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  loading={saving}
                  disabled={!formName.trim() || !formCode.trim()}
                >
                  <Save className="h-4 w-4" />
                  {editingId ? 'Update' : 'Create'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <EmptyState
          icon={<MapPin className="h-6 w-6" />}
          title="Failed to Load Regions"
          description={error}
          action={{ label: 'Retry', onClick: fetchRegions }}
        />
      )}

      {/* Region List */}
      {!loading && !error && regions.length === 0 && (
        <EmptyState
          icon={<MapPin className="h-8 w-8" />}
          title="No Regions Defined"
          description="Create your first region to start organising vehicles and offices by geographic area."
          action={{ label: 'Add Region', onClick: openCreateForm }}
        />
      )}

      {!loading && !error && regions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>All Regions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {regions.map((region) => (
                <div
                  key={region.id}
                  className={`flex items-center justify-between px-5 py-3.5 transition-colors ${
                    !region.isActive ? 'opacity-60' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      region.isActive
                        ? 'bg-brand-50 text-brand-700'
                        : 'bg-muted text-ink-400'
                    }`}>
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink-950">{region.name}</span>
                        <Badge variant="info" size="sm">{region.code}</Badge>
                        {!region.isActive && (
                          <StatusBadge status="cancelled" label="Inactive" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-ink-500">
                        {region.description && <span>{region.description}</span>}
                        {region.sortOrder != null && region.sortOrder > 0 && (
                          <span className="flex items-center gap-1">
                            <GripVertical className="h-3 w-3" /> Order: {region.sortOrder}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEditForm(region)}
                      title="Edit region"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleToggleActive(region)}
                      title={region.isActive ? 'Deactivate region' : 'Activate region'}
                    >
                      {region.isActive ? (
                        <XCircle className="h-4 w-4 text-ink-400" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(region.id)}
                      loading={deleting === region.id}
                      title="Delete region"
                      className="text-status-error-text hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="text-xs text-ink-500">
            {regions.length} region{regions.length !== 1 ? 's' : ''} total
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

