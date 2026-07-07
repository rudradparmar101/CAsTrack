'use client';

import React, { useState } from 'react';
import { Plus, LayoutTemplate, Edit, Trash2, ListChecks, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { PriorityBadge } from '@/components/priority-badge';
import { TemplateForm } from './template-form';
import { createTemplateAction, updateTemplateAction, deleteTemplateAction } from './actions';
import type { TaskTemplate } from '@/lib/types';

interface TemplatesPageClientProps {
  templates: TaskTemplate[];
}

export function TemplatesPageClient({ templates }: TemplatesPageClientProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete template "${title}"? This cannot be undone.`)) return;
    await deleteTemplateAction(id);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Task Templates</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {templates.length} template{templates.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" />
          New Template
        </Button>
      </div>

      {/* Template Grid */}
      {templates.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id} padding="md" hover>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">
                    {template.title}
                  </h3>
                  {template.description && (
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-2">
                      {template.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditingTemplate(template)}
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-primary-light)] transition-colors"
                    title="Edit template"
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(template.id, template.title)}
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors"
                    title="Delete template"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center flex-wrap gap-3 text-xs text-[var(--color-text-muted)] pt-3 border-t border-[var(--color-border)]">
                <PriorityBadge priority={template.default_priority} size="sm" />
                {template.recurring_rule && template.recurring_rule !== 'none' && (
                  <span className="inline-flex items-center gap-1 text-[var(--color-primary)]">
                    <Repeat className="h-3.5 w-3.5" />
                    {template.recurring_rule.charAt(0).toUpperCase() + template.recurring_rule.slice(1)}
                  </span>
                )}
                {template.checklist_items?.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <ListChecks className="h-3.5 w-3.5" />
                    {template.checklist_items.length} item{template.checklist_items.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<LayoutTemplate className="h-12 w-12" />}
            title="No templates yet"
            description="Create reusable task templates for recurring accounting workflows like VAT filings or audits."
            action={
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="h-4 w-4" />
                New Template
              </Button>
            }
          />
        </Card>
      )}

      {/* Create Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Task Template"
        maxWidth="lg"
      >
        <TemplateForm
          action={createTemplateAction}
          onSuccess={() => setShowCreateModal(false)}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={!!editingTemplate}
        onClose={() => setEditingTemplate(null)}
        title="Edit Task Template"
        maxWidth="lg"
      >
        {editingTemplate && (
          <TemplateForm
            template={editingTemplate}
            action={updateTemplateAction}
            onSuccess={() => setEditingTemplate(null)}
            onCancel={() => setEditingTemplate(null)}
          />
        )}
      </Modal>
    </div>
  );
}
