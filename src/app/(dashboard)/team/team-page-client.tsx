'use client';

import React, { useState } from 'react';
import { Plus, Edit, Trash2, Users2, Crown, UserPlus, ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/empty-state';
import { TeamInviteCode } from './team-invite-code';
import { TeamForm } from './team-form';
import { TeamMembersModal } from './team-members-modal';
import { createTeamAction, updateTeamAction, deleteTeamAction, changeRoleAction, fetchMoreMembersAction } from './actions';
import { MEMBERS_PAGE_SIZE } from '@/lib/pagination';
import type { TeamWithDetails, Profile } from '@/lib/types';

interface TeamPageClientProps {
  members: Profile[];
  allMembersLite: { id: string; name: string; email: string }[];
  teams: TeamWithDetails[];
  organization: { invite_code: string };
  currentUserId: string;
  initialHasMore: boolean;
}

export function TeamPageClient({
  members,
  allMembersLite,
  teams,
  organization,
  currentUserId,
  initialHasMore,
}: TeamPageClientProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamWithDetails | null>(null);
  const [managingTeam, setManagingTeam] = useState<TeamWithDetails | null>(null);
  const [roleError, setRoleError] = useState('');
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

  const memberOptions = allMembersLite.map((m) => ({ id: m.id, name: m.name }));
  const allMembersWithEmail = allMembersLite;

  const handleDelete = async (teamId: string, teamName: string) => {
    if (!confirm(`Delete team "${teamName}"? This cannot be undone.`)) return;
    await deleteTeamAction(teamId);
  };

  const handleRoleChange = async (memberId: string, memberName: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    const action = newRole === 'admin' ? 'promote' : 'demote';
    if (!confirm(`${action === 'promote' ? 'Promote' : 'Demote'} ${memberName} to ${newRole}?`)) return;

    setRoleError('');
    const result = await changeRoleAction(memberId, newRole);
    if (!result.success) {
      setRoleError(result.error || 'Failed to change role');
      setTimeout(() => setRoleError(''), 5000);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Team</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {allMembersLite.length} member{allMembersLite.length !== 1 ? 's' : ''} · {teams.length} team{teams.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" />
          Create Team
        </Button>
      </div>

      {/* Invite Code */}
      <TeamInviteCode inviteCode={organization.invite_code} />

      {/* Teams Section */}
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-3">
          Teams
        </h2>

        {teams.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <Card key={team.id} padding="md" hover>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">
                      {team.name}
                    </h3>
                    {team.description && (
                      <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-2">
                        {team.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingTeam(team)}
                      className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-primary-light)] transition-colors"
                      title="Edit team"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(team.id, team.name)}
                      className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors"
                      title="Delete team"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Lead */}
                {team.lead && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] mb-3">
                    <Crown className="h-3.5 w-3.5 text-amber-500" />
                    <span>Lead: {team.lead.name}</span>
                  </div>
                )}

                {/* Members preview */}
                <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    {/* Stacked avatars */}
                    <div className="flex -space-x-2">
                      {team.members.slice(0, 4).map((member) => (
                        <div
                          key={member.user_id}
                          className="h-7 w-7 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] flex items-center justify-center text-[10px] font-semibold border-2 border-[var(--color-surface)]"
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
                      {team.members.length > 4 && (
                        <div className="h-7 w-7 rounded-full bg-[var(--color-background)] text-[var(--color-text-muted)] flex items-center justify-center text-[10px] font-medium border-2 border-[var(--color-surface)]">
                          +{team.members.length - 4}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {team.members.length} member{team.members.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setManagingTeam(team)}
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
              title="No teams yet"
              description="Create teams to organize your members and assign tasks to groups."
              action={
                <Button onClick={() => setShowCreateModal(true)} size="sm">
                  <Plus className="h-4 w-4" />
                  Create First Team
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

        {roleError && (
          <div className="rounded-lg bg-[var(--color-danger-bg)] text-[var(--color-danger)] text-sm px-4 py-3 mb-3 animate-fade-in">
            {roleError}
          </div>
        )}

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
                    Teams
                  </th>
                  <th className="text-right text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider px-6 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {memberList.map((member) => {
                  const memberTeams = teams.filter((t) =>
                    t.members.some((m) => m.user_id === member.id)
                  );
                  const isSelf = member.id === currentUserId;

                  return (
                    <tr key={member.id} className="hover:bg-[var(--color-primary-light)] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center text-[var(--color-primary)] text-sm font-medium">
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
                        <Badge variant={member.role === 'admin' ? 'info' : 'default'}>
                          {member.role === 'admin' ? 'Admin' : 'Member'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {memberTeams.length > 0 ? (
                            memberTeams.map((t) => (
                              <Badge key={t.id} variant="default">
                                {t.name}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)] italic">
                              No teams
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {!isSelf && (
                          <button
                            onClick={() => handleRoleChange(member.id, member.name, member.role)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                              member.role === 'admin'
                                ? 'text-amber-700 bg-[var(--color-warning-bg)] hover:bg-amber-100'
                                : 'text-[var(--color-primary)] bg-[var(--color-primary-light)] hover:bg-indigo-100'
                            }`}
                            title={member.role === 'admin' ? 'Demote to Member' : 'Promote to Admin'}
                          >
                            {member.role === 'admin' ? (
                              <><ShieldOff className="h-3.5 w-3.5" /> Demote</>
                            ) : (
                              <><ShieldCheck className="h-3.5 w-3.5" /> Promote</>
                            )}
                          </button>
                        )}
                      </td>
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

      {/* Create Team Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Team"
      >
        <TeamForm
          members={memberOptions}
          action={createTeamAction}
          onSuccess={() => setShowCreateModal(false)}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>

      {/* Edit Team Modal */}
      <Modal
        open={!!editingTeam}
        onClose={() => setEditingTeam(null)}
        title="Edit Team"
      >
        {editingTeam && (
          <TeamForm
            team={editingTeam}
            members={memberOptions}
            action={updateTeamAction}
            onSuccess={() => setEditingTeam(null)}
            onCancel={() => setEditingTeam(null)}
          />
        )}
      </Modal>

      {/* Manage Members Modal */}
      <Modal
        open={!!managingTeam}
        onClose={() => setManagingTeam(null)}
        title={`Manage Members — ${managingTeam?.name}`}
        maxWidth="md"
      >
        {managingTeam && (
          <TeamMembersModal
            team={managingTeam}
            allMembers={allMembersWithEmail}
            onClose={() => setManagingTeam(null)}
          />
        )}
      </Modal>
    </div>
  );
}
