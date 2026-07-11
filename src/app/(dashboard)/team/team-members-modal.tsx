'use client';

import React, { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { addDepartmentMemberAction, removeDepartmentMemberAction } from './actions';
import type { DepartmentWithMembers } from '@/lib/types';

interface TeamMembersModalProps {
  department: DepartmentWithMembers;
  allMembers: { id: string; name: string; email: string }[];
  onClose: () => void;
}

export function TeamMembersModal({
  department,
  allMembers,
  onClose,
}: TeamMembersModalProps) {
  const [addingMember, setAddingMember] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const currentMemberIds = new Set(department.members.map((m) => m.user_id));
  const availableMembers = allMembers.filter((m) => !currentMemberIds.has(m.id));

  const memberOptions = [
    { value: '', label: 'Select a member...' },
    ...availableMembers.map((m) => ({
      value: m.id,
      label: `${m.name} (${m.email})`,
    })),
  ];

  const handleAdd = async () => {
    if (!selectedUserId) return;
    setLoading(true);
    setError('');
    const result = await addDepartmentMemberAction(department.id, selectedUserId);
    if (result.success) {
      setSelectedUserId('');
      setAddingMember(false);
    } else {
      setError(result.error || 'Failed to add member');
    }
    setLoading(false);
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('Remove this member from the department?')) return;
    const result = await removeDepartmentMemberAction(department.id, userId);
    if (!result.success) {
      setError(result.error || 'Failed to remove member');
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] text-[var(--color-danger)] text-sm px-4 py-3">
          {error}
        </div>
      )}

      {/* Current members list */}
      <div className="space-y-2">
        {department.members.length > 0 ? (
          department.members.map((member) => (
            <div
              key={member.user_id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--color-muted)] group"
            >
              <div className="h-8 w-8 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center text-[var(--color-accent)] text-xs font-semibold shrink-0">
                {member.profile.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-text)] truncate">
                    {member.profile.name}
                  </span>
                  <Badge variant={member.profile.role === 'partner' ? 'info' : 'default'}>
                    {member.profile.role}
                  </Badge>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] truncate">
                  {member.profile.email}
                </p>
              </div>
              <button
                onClick={() => handleRemove(member.user_id)}
                className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors opacity-0 group-hover:opacity-100"
                title="Remove from department"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-4">
            No members in this department yet.
          </p>
        )}
      </div>

      {/* Add member */}
      {addingMember ? (
        <div className="flex items-end gap-2 pt-2 border-t border-[var(--color-border)]">
          <div className="flex-1">
            <Select
              label="Add Member"
              name="add_member"
              options={memberOptions}
              defaultValue=""
              onChange={(e) => setSelectedUserId(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            loading={loading}
            onClick={handleAdd}
            disabled={!selectedUserId}
          >
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAddingMember(false);
              setSelectedUserId('');
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="pt-2 border-t border-[var(--color-border)]">
          {availableMembers.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddingMember(true)}
              className="w-full justify-center"
            >
              <UserPlus className="h-4 w-4" />
              Add Member
            </Button>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-2">
              All firm members are in this department
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end pt-4 sticky bottom-0 -mx-6 px-6 pb-2 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
