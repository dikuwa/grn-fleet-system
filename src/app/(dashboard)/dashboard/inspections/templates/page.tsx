'use client';

import { useState, useEffect } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ClipboardList,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Edit3,
  Trash2,
  ChevronRight,
  GripVertical,
} from 'lucide-react';
import Link from 'next/link';

interface TemplateItem {
  id: string;
  sortOrder: number;
  category: string;
  label: string;
  requiresPhoto: boolean;
  isCritical: boolean;
}

interface Template {
  id: string;
  name: string;
  type: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  items: TemplateItem[];
}

const CATEGORIES = ['exterior', 'interior', 'tyres', 'lights', 'documents', 'safety', 'fuel'];

const CATEGORY_LABELS: Record<string, string> = {
  exterior: 'Exterior',
  interior: 'Interior',
  tyres: 'Tyres & Wheels',
  lights: 'Lights & Electrical',
  documents: 'Documents & Compliance',
  safety: 'Safety Equipment',
  fuel: 'Fuel',
};

const DEFAULT_ITEMS: Record<string, { category: string; label: string; isCritical: boolean }[]> = {
  departure: [
    { category: 'exterior', label: 'Body panels and paint condition', isCritical: false },
    { category: 'exterior', label: 'Windshield and windows (no cracks)', isCritical: true },
    { category: 'exterior', label: 'Mirrors (both sides, rearview)', isCritical: false },
    { category: 'tyres', label: 'Tyre tread depth and pressure', isCritical: true },
    { category: 'tyres', label: 'Spare tyre present and secure', isCritical: false },
    { category: 'lights', label: 'Headlights (high/low beam)', isCritical: true },
    { category: 'lights', label: 'Tail lights and brake lights', isCritical: true },
    { category: 'lights', label: 'Indicators and hazard lights', isCritical: true },
    { category: 'interior', label: 'Seat belts (all positions)', isCritical: true },
    { category: 'interior', label: 'Horn working', isCritical: false },
    { category: 'interior', label: 'Wipers and washer fluid', isCritical: false },
    { category: 'safety', label: 'Fire extinguisher present', isCritical: true },
    { category: 'safety', label: 'First aid kit present', isCritical: false },
    { category: 'safety', label: 'Warning triangle/reflectors', isCritical: false },
    { category: 'documents', label: 'Vehicle licence disc valid', isCritical: true },
    { category: 'documents', label: 'Roadworthy certificate valid', isCritical: true },
  ],
  return: [
    { category: 'exterior', label: 'Body panels and paint condition', isCritical: false },
    { category: 'exterior', label: 'Windshield and windows intact', isCritical: true },
    { category: 'tyres', label: 'Tyre condition (no damage)', isCritical: true },
    { category: 'lights', label: 'All lights functional', isCritical: false },
    { category: 'interior', label: 'Interior clean and undamaged', isCritical: false },
    { category: 'interior', label: 'Tool kit and jack present', isCritical: false },
    { category: 'safety', label: 'Fire extinguisher still present', isCritical: true },
    { category: 'safety', label: 'First aid kit present', isCritical: false },
    { category: 'fuel', label: 'Fuel level matches trip records', isCritical: false },
  ],
};

export default function InspectionTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'departure' | 'return'>('departure');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formItems, setFormItems] = useState<{ category: string; label: string; isCritical: boolean }[]>([]);

  useEffect(() => {
    fetchTemplates();
  }, [activeTab]);

  async function fetchTemplates() {
    setLoading(true);
    try {
      const res = await fetch(`/api/inspection-templates?type=${activeTab}`);
      if (!res.ok) throw new Error('Failed to load templates');
      const json = await res.json();
      setTemplates(json.templates ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  function openCreateForm() {
    setEditingTemplate(null);
    setFormName(activeTab === 'departure' ? 'Default Departure Checklist' : 'Default Return Checklist');
    setFormItems([...DEFAULT_ITEMS[activeTab]]);
    setShowCreateForm(true);
  }

  function openEditForm(tpl: Template) {
    setEditingTemplate(tpl);
    setFormName(tpl.name);
    setFormItems(tpl.items.map((i) => ({ category: i.category, label: i.label, isCritical: i.isCritical })));
    setShowCreateForm(true);
  }

  function closeForm() {
    setShowCreateForm(false);
    setEditingTemplate(null);
  }

  function addItem() {
    setFormItems([...formItems, { category: 'exterior', label: '', isCritical: false }]);
  }

  function updateItem(index: number, field: string, value: string | boolean) {
    const updated = [...formItems];
    updated[index] = { ...updated[index], [field]: value };
    setFormItems(updated);
  }

  function removeItem(index: number) {
    setFormItems(formItems.filter((_, i) => i !== index));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;
    setSubmitting(true);

    const filteredItems = formItems
      .filter((item) => item.label.trim())
      .map((item, index) => ({
        sortOrder: index,
        category: item.category,
        label: item.label.trim(),
        requiresPhoto: false,
        isCritical: item.isCritical,
      }));

    try {
      if (editingTemplate) {
        const res = await fetch(`/api/inspection-templates/${editingTemplate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName.trim(), items: filteredItems }),
        });
        if (!res.ok) throw new Error('Failed to update template');
      } else {
        const res = await fetch('/api/inspection-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formName.trim(),
            type: activeTab,
            items: filteredItems,
          }),
        });
        if (!res.ok) throw new Error('Failed to create template');
      }

      closeForm();
      await fetchTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(tpl: Template) {
    try {
      const res = await fetch(`/api/inspection-templates/${tpl.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !tpl.isActive }),
      });
      if (!res.ok) throw new Error('Failed to update template');
      await fetchTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update template');
    }
  }

  async function handleDelete(tpl: Template) {
    if (!confirm(`Delete "${tpl.name}"? This action cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/inspection-templates/${tpl.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete template');
      await fetchTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    }
  }

  const filtered = templates;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inspections', href: '/dashboard/inspections' },
          { label: 'Templates' },
        ]}
      />
      <PageHeader title="Inspection Templates" description="Manage inspection checklists for departure and return inspections">
        <Button variant="primary" size="sm" onClick={openCreateForm}>
          <Plus className="h-4 w-4" />
          New Template
        </Button>
      </PageHeader>

      {error && (
        <div className="rounded-[10px] border border-status-error-bg bg-status-error-bg/20 px-4 py-3 text-sm text-status-error-text">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-status-error-text underline">Dismiss</button>
        </div>
      )}

      {/* Type Tabs */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('departure')}
              className={`px-4 py-1.5 text-sm rounded-full transition-colors ${activeTab === 'departure' ? 'bg-brand-800 text-white' : 'text-ink-500 hover:text-ink-700 hover:bg-muted'}`}
            >
              Departure
            </button>
            <button
              onClick={() => setActiveTab('return')}
              className={`px-4 py-1.5 text-sm rounded-full transition-colors ${activeTab === 'return' ? 'bg-brand-800 text-white' : 'text-ink-500 hover:text-ink-700 hover:bg-muted'}`}
            >
              Return
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Template List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title={`No ${activeTab} templates`}
          description={`Create a ${activeTab} inspection template to get started.`}
          action={{ label: 'Create Template', onClick: openCreateForm }}
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((tpl) => (
            <Card key={tpl.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-[650] text-ink-950">{tpl.name}</p>
                      <Badge variant={tpl.isActive ? 'success' : 'info'} size="sm">
                        {tpl.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                      <Badge variant="info" size="sm">v{tpl.version}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {tpl.items.length} item{tpl.items.length !== 1 ? 's' : ''} · {tpl.type} inspection
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="secondary" size="sm" onClick={() => openEditForm(tpl)}>
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleToggleActive(tpl)}>
                      {tpl.isActive ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleDelete(tpl)}>
                      <Trash2 className="h-3.5 w-3.5 text-status-error-text" />
                    </Button>
                  </div>
                </div>

                {/* Items preview */}
                {tpl.items.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {CATEGORIES.filter((cat) => tpl.items.some((i) => i.category === cat)).map((cat) => (
                      <div key={cat} className="flex items-center gap-2 text-xs text-ink-500">
                        <span className="w-24 shrink-0 font-medium text-ink-600">{CATEGORY_LABELS[cat] ?? cat}</span>
                        <span className="truncate">
                          {tpl.items.filter((i) => i.category === cat).map((i) => i.label).join(', ')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-surface/80 backdrop-blur-sm pt-8 pb-16">
          <Card className="w-full max-w-2xl mx-4">
            <CardHeader>
              <CardTitle>{editingTemplate ? 'Edit Template' : 'New Template'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink-500 mb-1.5">Template Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                    placeholder="e.g. Standard Departure Checklist"
                    className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-ink-500">Checklist Items</label>
                    <Button variant="secondary" size="sm" type="button" onClick={addItem}>
                      <Plus className="h-3.5 w-3.5" /> Add Item
                    </Button>
                  </div>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {formItems.map((item, index) => (
                      <div key={index} className="flex items-start gap-2 rounded-[8px] border border-border bg-surface p-3">
                        <div className="pt-1 text-ink-300">
                          <GripVertical className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0 grid gap-2 sm:grid-cols-3">
                          <div>
                            <select
                              value={item.category}
                              onChange={(e) => updateItem(index, 'category', e.target.value)}
                              className="h-9 w-full rounded-[6px] border border-border bg-white px-2 text-xs text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                            >
                              {CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>{CATEGORY_LABELS[cat] ?? cat}</option>
                              ))}
                            </select>
                          </div>
                          <div className="sm:col-span-2">
                            <input
                              type="text"
                              value={item.label}
                              onChange={(e) => updateItem(index, 'label', e.target.value)}
                              placeholder="Inspection item label..."
                              className="h-9 w-full rounded-[6px] border border-border bg-white px-2 text-xs text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 pt-0.5">
                          <label className="flex items-center gap-1 text-xs text-ink-500 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.isCritical}
                              onChange={(e) => updateItem(index, 'isCritical', e.target.checked)}
                              className="rounded border-border"
                            />
                            Critical
                          </label>
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="text-status-error-text hover:text-status-error-text/80"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button variant="secondary" size="sm" type="button" onClick={closeForm}>Cancel</Button>
                  <Button variant="primary" size="sm" type="submit" loading={submitting}>
                    {editingTemplate ? 'Update Template' : 'Create Template'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
