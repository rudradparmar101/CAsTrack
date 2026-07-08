'use client';

import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Send, Edit, Trash2, MoreHorizontal, Eye, EyeOff, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  addTaskCommentAction,
  updateTaskCommentAction,
  deleteTaskCommentAction,
} from '@/lib/tasks/comments';
import type { FirmTaskCommentWithAuthor } from '@/lib/types';

interface TaskCommentsProps {
  taskId: string;
  comments: FirmTaskCommentWithAuthor[];
  /** 'staff' shows the internal/client-visible toggle + visibility chips.
   *  'client' (portal) only ever receives client-visible comments from RLS,
   *  and everything a client posts is forced client-visible. */
  viewer: 'staff' | 'client';
  currentUserId: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function TaskComments({ taskId, comments, viewer, currentUserId }: TaskCommentsProps) {
  const [commentText, setCommentText] = useState('');
  const [visibleToClient, setVisibleToClient] = useState(false);
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const authorName = (comment: FirmTaskCommentWithAuthor) =>
    comment.author?.name || (viewer === 'client' ? 'Your CA firm' : 'Unknown');

  const handlePost = async () => {
    if (!commentText.trim()) return;
    setPosting(true);
    setError('');
    const result = await addTaskCommentAction(taskId, commentText, visibleToClient);
    if (result.success) {
      setCommentText('');
      setVisibleToClient(false);
    } else {
      setError(result.error || 'Failed to post the comment.');
    }
    setPosting(false);
  };

  const handleUpdate = async (commentId: string) => {
    if (!editingText.trim()) return;
    setPosting(true);
    const result = await updateTaskCommentAction(commentId, taskId, editingText);
    if (result.success) {
      setEditingId(null);
      setEditingText('');
    } else {
      setError(result.error || 'Failed to update the comment.');
    }
    setPosting(false);
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;
    setMenuOpenId(null);
    const result = await deleteTaskCommentAction(commentId, taskId);
    if (!result.success) setError(result.error || 'Failed to delete the comment.');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handlePost();
    }
  };

  return (
    <Card padding="lg">
      <div className="flex items-center gap-2 mb-5">
        <MessageSquare className="h-5 w-5 text-[var(--color-text-muted)]" />
        <h2 className="text-base font-semibold text-[var(--color-text)]">Comments</h2>
        {comments.length > 0 && (
          <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-accent-muted)] rounded-full px-2 py-0.5">
            {comments.length}
          </span>
        )}
      </div>

      {comments.length > 0 ? (
        <div className="space-y-4 mb-6">
          {comments.map((comment) => {
            const isOwn = comment.created_by === currentUserId;
            const isEditing = editingId === comment.id;

            return (
              <div key={comment.id} className="flex gap-3 group/comment animate-fade-in">
                <div className="h-8 w-8 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)] flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">
                  {getInitials(authorName(comment))}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {authorName(comment)}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)]">
                      {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                    </span>
                    {comment.created_at !== comment.updated_at && (
                      <span className="text-[10px] text-[var(--color-text-muted)] italic">
                        (edited)
                      </span>
                    )}
                    {viewer === 'staff' &&
                      (comment.visible_to_client ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] text-[var(--color-accent)]"
                          title="Visible in the client portal"
                        >
                          <Eye className="h-3 w-3" />
                          Client-visible
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]"
                          title="Internal — hidden from the client portal"
                        >
                          <EyeOff className="h-3 w-3" />
                          Internal
                        </span>
                      ))}

                    {isOwn && !isEditing && (
                      <div className="relative ml-auto">
                        <button
                          onClick={() => setMenuOpenId(menuOpenId === comment.id ? null : comment.id)}
                          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-accent-muted)] transition-colors opacity-0 group-hover/comment:opacity-100"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menuOpenId === comment.id && (
                          <div className="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 z-10 min-w-[120px] animate-scale-in">
                            <button
                              onClick={() => {
                                setEditingId(comment.id);
                                setEditingText(comment.content);
                                setMenuOpenId(null);
                              }}
                              className="w-full text-left px-3 py-1.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-accent-muted)] flex items-center gap-2"
                            >
                              <Edit className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(comment.id)}
                              className="w-full text-left px-3 py-1.5 text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] flex items-center gap-2"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="mt-1.5 space-y-2">
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-input-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent resize-y min-h-[60px]"
                        rows={2}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          loading={posting}
                          onClick={() => handleUpdate(comment.id)}
                          disabled={!editingText.trim()}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(null);
                            setEditingText('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--color-text-secondary)] mt-0.5 whitespace-pre-wrap leading-relaxed">
                      {comment.content}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mb-6">
          <EmptyState
            icon={<MessageSquare className="h-10 w-10" />}
            title="No comments yet"
            description={
              viewer === 'client'
                ? 'Messages from your CA firm will appear here.'
                : 'Be the first to add a comment to this task.'
            }
          />
        </div>
      )}

      {/* New comment form */}
      <div className="border-t border-[var(--color-border)] pt-4">
        <div className="flex gap-3">
          <div className="h-8 w-8 rounded-full bg-[var(--color-accent)] text-[var(--color-accent-foreground)] flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">
            <User className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                viewer === 'client' ? 'Write a message to your CA firm...' : 'Write a comment...'
              }
              className="w-full rounded-lg border border-[var(--color-border)] px-3.5 py-2.5 text-sm bg-[var(--color-input-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent resize-y min-h-[80px] transition-colors duration-150"
              rows={3}
            />
            {error && <p className="text-xs text-[var(--color-danger)] mt-1">{error}</p>}
            <div className="flex items-center justify-between mt-2 gap-3 flex-wrap">
              {viewer === 'staff' ? (
                <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <input
                    type="checkbox"
                    checked={visibleToClient}
                    onChange={(e) => setVisibleToClient(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[var(--color-border)]"
                  />
                  Visible to client
                </label>
              ) : (
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  Your CA firm will see this message.
                </p>
              )}
              <Button size="sm" loading={posting} onClick={handlePost} disabled={!commentText.trim()}>
                <Send className="h-3.5 w-3.5" />
                Comment
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
