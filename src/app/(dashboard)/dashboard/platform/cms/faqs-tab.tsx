'use client';

/**
 * FAQs tab — Platform Admin management of the public FAQ entries.
 *
 * Full CRUD: add, edit, reorder, publish/unpublish, and delete (with a
 * confirmation step). All mutations go through the platform FAQ admin API,
 * which validates and length-caps content server-side.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  ChevronUp,
  ChevronDown,
  Pencil,
  X,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Faq {
  id: string;
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
  isPublished: boolean;
  updatedAt: string;
}

const CATEGORIES = ['general', 'platform', 'security', 'pilot', 'support'];

const inputClass = () =>
  'w-full h-10 px-3 text-sm border border-border rounded-[8px] bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500';

const textareaClass = () =>
  'w-full px-3 py-2 text-sm border border-border rounded-[8px] bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FaqsTab() {
  const { toast } = useToast();

  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state: null = closed
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    question: string;
    answer: string;
    category: string;
    sortOrder: number;
    isPublished: boolean;
  } | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Refresh without a spinner — used by buttons (retry, after save/delete).
  const refreshFaqs = useCallback(async () => {
    try {
      const res = await fetch('/api/platform/cms/faqs');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch FAQs');
      setError(null);
      setFaqs(json.data.faqs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load FAQs');
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch('/api/platform/cms/faqs');
        const json = await res.json();
        if (ignore) return;
        if (!res.ok) throw new Error(json.error || 'Failed to fetch FAQs');
        setError(null);
        setFaqs(json.data.faqs);
        setLoading(false);
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Failed to load FAQs');
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setDraft({ question: '', answer: '', category: 'general', sortOrder: faqs.length, isPublished: true });
  };

  const openEdit = (faq: Faq) => {
    setConfirmDeleteId(null);
    setEditingId(faq.id);
    setDraft({
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      sortOrder: faq.sortOrder,
      isPublished: faq.isPublished,
    });
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft(null);
    setConfirmDeleteId(null);
  };

  const handleSave = async () => {
    if (!draft || !draft.question.trim() || !draft.answer.trim()) {
      toast({ title: 'Incomplete', description: 'Question and answer are required.', variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        question: draft.question,
        answer: draft.answer,
        category: draft.category,
        sortOrder: draft.sortOrder,
        isPublished: draft.isPublished,
      };
      const url = editingId
        ? `/api/platform/cms/faqs/${editingId}`
        : '/api/platform/cms/faqs';
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save FAQ');
      toast({
        title: 'Saved',
        description: editingId ? 'FAQ updated.' : 'FAQ added.',
        variant: 'success',
      });
      closeEditor();
      void refreshFaqs();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/platform/cms/faqs/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to delete FAQ');
      toast({ title: 'Deleted', description: 'FAQ removed.', variant: 'success' });
      if (editingId === id) closeEditor();
      void refreshFaqs();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= faqs.length) return;
    const next = [...faqs];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    // Persist the new order immediately.
    const ordered = next.map((f, i) => ({ ...f, sortOrder: i }));
    setFaqs(ordered);
    void Promise.all(
      ordered.map((f) =>
        fetch(`/api/platform/cms/faqs/${f.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: f.sortOrder }),
        }).catch(() => null),
      ),
    ).then(() => toast({ title: 'Reordered', description: 'FAQ order saved.', variant: 'success' }));
  };

  const togglePublish = async (faq: Faq) => {
    try {
      const res = await fetch(`/api/platform/cms/faqs/${faq.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: !faq.isPublished }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update FAQ');
      setFaqs((prev) =>
        prev.map((f) => (f.id === faq.id ? { ...f, isPublished: !faq.isPublished } : f)),
      );
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
        <span className="ml-2 text-sm text-ink-500">Loading FAQs…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-status-error-text">{error}</p>
        <Button variant="secondary" size="compact" onClick={() => void refreshFaqs()} className="mt-3">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-500">
          {faqs.length} FAQ{faqs.length === 1 ? '' : 's'} — published entries appear on the
          homepage and /faq.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Add FAQ
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* List */}
        <div className="space-y-2 lg:col-span-3">
          {faqs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-ink-500 mb-1">No FAQs yet</p>
                <p className="text-xs text-ink-400">Add your first FAQ to populate the public FAQ section.</p>
              </CardContent>
            </Card>
          ) : (
            faqs.map((faq, index) => (
              <Card
                key={faq.id}
                className={`transition-colors ${editingId === faq.id ? 'border-brand-400' : ''}`}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-0.5 text-ink-300">
                      <button
                        type="button"
                        aria-label="Move up"
                        onClick={() => move(index, -1)}
                        className="rounded hover:text-ink-700"
                        disabled={index === 0}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        onClick={() => move(index, 1)}
                        className="rounded hover:text-ink-700"
                        disabled={index === faqs.length - 1}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-ink-900">{faq.question}</p>
                        <Badge
                          variant={faq.isPublished ? 'success' : 'default'}
                          size="sm"
                        >
                          {faq.isPublished ? 'Published' : 'Draft'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-ink-500 mt-0.5">
                        <span className="font-mono">{faq.category}</span>
                        <span>·</span>
                        <span>Order {faq.sortOrder}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="compact"
                        onClick={() => togglePublish(faq)}
                        title={faq.isPublished ? 'Unpublish' : 'Publish'}
                      >
                        <Badge variant={faq.isPublished ? 'default' : 'success'} size="sm" className="pointer-events-none">
                          {faq.isPublished ? 'Unpublish' : 'Publish'}
                        </Badge>
                      </Button>
                      <Button variant="ghost" size="compact" onClick={() => openEdit(faq)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {confirmDeleteId === faq.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="destructive"
                            size="compact"
                            onClick={() => handleDelete(faq.id)}
                          >
                            Confirm
                          </Button>
                          <Button variant="ghost" size="compact" onClick={() => setConfirmDeleteId(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="compact"
                          className="text-status-error-text"
                          onClick={() => setConfirmDeleteId(faq.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Editor */}
        <div className="lg:col-span-2">
          {draft ? (
            <Card className="lg:sticky lg:top-20">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink-900">
                    {editingId ? 'Edit FAQ' : 'New FAQ'}
                  </h3>
                  <Button variant="ghost" size="compact" onClick={closeEditor} aria-label="Close editor">
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-ink-800">Question</Label>
                  <Input
                    className={inputClass()}
                    value={draft.question}
                    maxLength={300}
                    onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                    placeholder="e.g. What is GovFleet?"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-ink-800">Answer</Label>
                  <Textarea
                    className={textareaClass()}
                    rows={6}
                    value={draft.answer}
                    maxLength={4000}
                    onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
                    placeholder="A clear, factual answer…"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-ink-800">Category</Label>
                    <select
                      className={inputClass()}
                      value={draft.category}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-ink-800">Order</Label>
                    <Input
                      className={inputClass()}
                      type="number"
                      min={0}
                      value={draft.sortOrder}
                      onChange={(e) =>
                        setDraft({ ...draft, sortOrder: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-ink-800">
                  <input
                    type="checkbox"
                    checked={draft.isPublished}
                    onChange={(e) => setDraft({ ...draft, isPublished: e.target.checked })}
                    className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-500"
                  />
                  Published on public site
                </label>

                <div className="flex gap-2 pt-1">
                  <Button onClick={handleSave} disabled={saving} size="sm" className="flex-1">
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-1" />
                        {editingId ? 'Save changes' : 'Add FAQ'}
                      </>
                    )}
                  </Button>
                  {editingId && (
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(editingId)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-ink-400">
                Select an FAQ to edit, or add a new one.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
