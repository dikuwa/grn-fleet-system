'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  MapPin,
  ChevronLeft,
  GripVertical,
} from 'lucide-react';
import Link from 'next/link';

interface Region {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export default function RegionsPage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);
  const [form, setForm] = useState({ name: '', code: '', description: '' });

  const fetchRegions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await fetch(`/api/regions?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRegions(data.rows ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  const openCreate = () => {
    setEditingRegion(null);
    setForm({ name: '', code: '', description: '' });
    setShowDialog(true);
  };

  const openEdit = (region: Region) => {
    setEditingRegion(region);
    setForm({
      name: region.name,
      code: region.code,
      description: region.description || '',
    });
    setShowDialog(true);
  };

  const handleSave = async () => {
    try {
      if (editingRegion) {
        await fetch('/api/regions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingRegion.id, ...form }),
        });
      } else {
        await fetch('/api/regions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      }
      setShowDialog(false);
      fetchRegions();
    } catch {
      // silently fail
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this region?')) return;
    try {
      await fetch(`/api/regions?id=${id}`, { method: 'DELETE' });
      fetchRegions();
    } catch {
      // silently fail
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Administration', href: '/dashboard/admin/users' },
          { label: 'Regions' },
        ]}
      />
      <PageHeader title="Region Management" description="Manage regions for vehicle assignment and reporting">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/admin/users">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
      </PageHeader>

      {/* Search & Create */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search regions..."
                className="h-10 w-full rounded-[8px] border border-border bg-surface pl-9 pr-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Region
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Regions List */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-ink-500">Loading...</CardContent>
        </Card>
      ) : regions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="mx-auto h-8 w-8 text-ink-300" />
            <h3 className="mt-3 text-sm font-semibold text-ink-950">No regions found</h3>
            <p className="mt-1 text-sm text-ink-500">Create your first region to get started.</p>
            <Button variant="primary" size="sm" className="mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Region
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {regions.map((region) => (
            <div
              key={region.id}
              className="flex items-center justify-between rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
                  <MapPin className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-[650] text-ink-950">{region.name}</p>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-ink-500">
                      {region.code}
                    </span>
                  </div>
                  {region.description && (
                    <p className="mt-0.5 text-xs text-ink-500">{region.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge
                  status={region.isActive ? 'success' : 'cancelled'}
                  label={region.isActive ? 'Active' : 'Inactive'}
                />
                <button
                  onClick={() => openEdit(region)}
                  className="flex h-8 w-8 items-center justify-center rounded-[6px] text-ink-400 hover:bg-muted hover:text-ink-700 transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(region.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-[6px] text-ink-400 hover:bg-status-error-bg hover:text-status-error-text transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[12px] border border-border bg-surface p-6 shadow-lg">
            <h3 className="text-base font-semibold text-ink-950">
              {editingRegion ? 'Edit Region' : 'Create Region'}
            </h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Kavango East"
                  className="h-10 w-full rounded-[8px] border border-border bg-canvas px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1">Code *</label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="e.g. KE"
                  className="h-10 w-full rounded-[8px] border border-border bg-canvas px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional description..."
                  rows={3}
                  className="h-20 w-full rounded-[8px] border border-border bg-canvas px-3 py-2 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 resize-none"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" size="sm" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={!form.name.trim() || !form.code.trim()}
              >
                {editingRegion ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
