// Shared page-size constants for paginated list views.
// Kept separate from server-action files since files with the
// 'use server' directive may only export async functions.
export const TASKS_PAGE_SIZE = 24;
export const CLIENTS_PAGE_SIZE = 20;
export const MEMBERS_PAGE_SIZE = 20;
export const PORTAL_TASKS_PAGE_SIZE = 20;
export const PORTAL_DOCUMENTS_PAGE_SIZE = 20;
