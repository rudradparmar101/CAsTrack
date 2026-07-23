'use client';

import React, { useState } from 'react';
import { Plus, Edit, Users2, UserPlus, Ban, CheckCircle2, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { TeamInviteCode } from './team-invite-code';
import { TeamForm } from './team-form';
import { TeamMembersModal } from './team-members-modal';
import { PermissionsEditorModal } from './permissions-editor-modal';
import { createDepartmentAction, updateDepartmentAction, toggleDepartmentActiveAction, fetchMoreMembersAction } from './actions';
import { MEMBERS_PAGE_SIZE } from '@/lib/pagination';
import type { DepartmentWithMembers, Profile } from '@/lib/types';

interface TeamPageClientProps {
  members: Profile[];
  allMembersLite: { id: string; name: string; email: string }[];
  departments: DepartmentWithMembers[];
  firm: { invite_code: string };
  currentUserId: string;
  currentUserIsPartner: boolean;
  initialHasMore: boolean;
}

export function TeamPageClient({
  members,
  allMembersLite,
  departments,
  firm,
  currentUserId,
  currentUserIsPartner,
  initialHasMore,
}: TeamPageClientProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<DepartmentWithMembers | null>(null);
  const [managingDepartment, setManagingDepartment] = useState<DepartmentWithMembers | null>(null);
  const [permissionsEmployee, setPermissionsEmployee] = useState<{ id: string; name: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const [memberList, setMemberList] = useState(members);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [prevMembers, setPrevMembers] = useState(members);

  if (members !== prevMembers) {
    setPrevMembers(members);
    setMemberList(members);
    setHasMore(initialHasMore);
  }

  const handleLoadMoreMembers = async () => {
    setLoadingMore(true);
    const result = await fetchMoreMembersAction(memberList.length);
    if (result.success && result.data) {
      setMemberList((prev) => [...prev, ...result.data!]);
      setHasMore(result.data.length === MEMBERS_PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  const handleToggleActive = async (departmentId: string, name: string, isActive: boolean) => {
    const verb = isActive ? 'Deactivate' : 'Reactivate';
    if (!confirm(`${verb} department "${name}"?`)) return;
    const result = await toggleDepartmentActiveAction(departmentId, !isActive);
    if (!result.success) {
      setActionError(result.error || 'Failed to update department');
      setTimeout(() => setActionError(''), 5000);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Team</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {allMembersLite.length} member{allMembersLite.length !== 1 ? 's' : ''} · {departments.length} department{departments.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" />
          Add Department
        </Button>
      </div>

      {/* Invite Code */}
      <TeamInviteCode inviteCode={firm.invite_code} />

      {actionError && (
        <div className="rounded-lg bg-[var(--color-danger-bg)] text-[var(--color-danger)] text-sm px-4 py-3 animate-fade-in">
          {actionError}
        </div>
      )}

      {/* Departments Section */}
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-3">
          Departments
        </h2>

        {departments.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((department) => (
              <Card key={department.id} padding="md" hover>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">
                        {department.name}
                      </h3>
                      {!department.is_active && (
                        <Badge variant="default">Inactive</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingDepartment(department)}
                      className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent-muted)] transition-colors"
                      title="Edit department"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleToggleActive(department.id, department.name, department.is_active)}
                      className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors"
                      title={department.is_active ? 'Deactivate department' : 'Reactivate department'}
                    >
                      {department.is_active ? (
                        <Ban className="h-3.5 w-3.5" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Members preview */}
                <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {department.members.slice(0, 4).map((member) => (
                        <div
                          key={member.user_id}
                          className="h-7 w-7 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)] flex items-center justify-center text-[10px] font-semibold border-2 border-[var(--color-surface)]"
                          title={member.profile.name}
                        >
                          {member.profile.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .toUpperCase()
                            .slice(0, 2)}
                        </div>
                      ))}
                      {department.members.length > 4 && (
                        <div className="h-7 w-7 rounded-full bg-[var(--color-background)] text-[var(--color-text-muted)] flex items-center justify-center text-[10px] font-medium border-2 border-[var(--color-surface)]">
                          +{department.members.length - 4}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {department.members.length} member{department.members.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setManagingDepartment(department)}
                    className="text-xs"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Manage
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card padding="lg">
            <EmptyState
              icon={<Users2 className="h-10 w-10" />}
              title="No departments yet"
              description="Add departments to organize your staff and scope tasks and templates."
              action={
                <Button onClick={() => setShowCreateModal(true)} size="sm">
                  <Plus className="h-4 w-4" />
                  Add First Department
                </Button>
              }
            />
          </Card>
        )}
      </div>

      {/* Members Table */}
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-3">
          All Members
        </h2>

        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3">
                    Member
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3 hidden sm:table-cell">
                    Email
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3">
                    Role
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3 hidden md:table-cell">
                    Departments
                  </th>
                  {currentUserIsPartner && (
                    <th className="text-right text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3">
                      Permissions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {memberList.map((member) => {
                  const memberDepartments = departments.filter((d) =>
                    d.members.some((m) => m.user_id === member.id)
                  );
                  const isSelf = member.id === currentUserId;

                  return (
                    <tr key={member.id} className="hover:bg-[var(--color-accent-muted)] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center text-[var(--color-accent)] text-sm font-medium">
                            {member.name
                              .split(' ')
                              .map((n: string) => n[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)}
                          </div>
                          <span className="text-sm font-medium text-[var(--color-text)]">
                            {member.name}
                            {isSelf && (
                              <span className="text-xs text-[var(--color-text-muted)] ml-1">(you)</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 hidden sm:table-cell">
                        <span className="text-sm text-[var(--color-text-secondary)]">
                          {member.email}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={member.role === 'partner' ? 'info' : 'default'}>
                          {member.role}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {memberDepartments.length > 0 ? (
                            memberDepartments.map((d) => (
                              <Badge key={d.id} variant="default">
                                {d.name}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)] italic">
                              No departments
                            </span>
                          )}
                        </div>
                      </td>
                      {currentUserIsPartner && (
                        <td className="px-6 py-4 text-right">
                          {member.role === 'employee' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPermissionsEmployee({ id: member.id, name: member.name })}
                            >
                              <Shield className="h-3.5 w-3.5" />
                              Permissions
                            </Button>
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {hasMore && (
          <div className="flex justify-center pt-4">
            <Button variant="secondary" loading={loadingMore} onClick={handleLoadMoreMembers}>
              Load More
            </Button>
          </div>
        )}
      </div>

      {/* Add Department Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Add Department"
      >
        <TeamForm
          action={createDepartmentAction}
          onSuccess={() => setShowCreateModal(false)}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>

      {/* Edit Department Modal */}
      <Modal
        open={!!editingDepartment}
        onClose={() => setEditingDepartment(null)}
        title="Edit Department"
      >
        {editingDepartment && (
          <TeamForm
            department={editingDepartment}
            action={updateDepartmentAction}
            onSuccess={() => setEditingDepartment(null)}
            onCancel={() => setEditingDepartment(null)}
          />
        )}
      </Modal>

      {/* Manage Members Modal */}
      <Modal
        open={!!managingDepartment}
        onClose={() => setManagingDepartment(null)}
        title={`Manage Members — ${managingDepartment?.name}`}
        maxWidth="md"
      >
        {managingDepartment && (
          <TeamMembersModal
            department={managingDepartment}
            allMembers={allMembersLite}
            onClose={() => setManagingDepartment(null)}
          />
        )}
      </Modal>

      {/* Permissions Modal */}
      <Modal
        open={!!permissionsEmployee}
        onClose={() => setPermissionsEmployee(null)}
        title={`Permissions — ${permissionsEmployee?.name}`}
        maxWidth="lg"
      >
        {permissionsEmployee && (
          <PermissionsEditorModal
            employee={permissionsEmployee}
            onClose={() => setPermissionsEmployee(null)}
          />
        )}
      </Modal>
    </div>
  );
}
