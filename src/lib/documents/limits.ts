/**
 * Upload size limit — ONE number, deliberately in its own module with no
 * imports, because `next.config.ts` also has to read it.
 *
 * Why this file exists (app-layer security audit, finding L5): the app checked
 * uploads against a 10 MB constant, but `next.config.ts` set no
 * `serverActions.bodySizeLimit`, and Next's default is 1 MB. The framework
 * rejected the request before the app's own check ever ran, so the friendly
 * "File exceeds the 10MB size limit." message was unreachable and a perfectly
 * ordinary 2 MB scanned PDF — the single most common thing a CA firm uploads —
 * failed with a framework error instead. Not a security hole (the effective
 * limit was TIGHTER than advertised), but a real product bug that would have
 * surfaced in the first week of the pilot.
 *
 * The fix is to keep the two in lockstep: `next.config.ts` imports
 * MAX_DOCUMENT_SIZE from here rather than restating it, so the framework limit
 * and the app limit cannot drift apart again. This module must stay
 * import-free and side-effect-free — it is evaluated in the Next config
 * context, not the app runtime.
 */

/** 10 MB. Comfortably covers a multi-page scanned PDF at 300 dpi. */
export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

/**
 * A small slack allowance over MAX_DOCUMENT_SIZE for the multipart envelope
 * and the other form fields that ride along with the file (name, doc_type,
 * task_id, the Server Action's own encoding overhead). Without it, a file of
 * exactly the allowed size would still trip the framework limit and produce
 * the unfriendly error this whole change exists to remove.
 */
export const SERVER_ACTION_BODY_LIMIT = MAX_DOCUMENT_SIZE + 1024 * 1024;

/** Human form used in UI hints and error messages, so they can't disagree. */
export function formatMaxDocumentSize(): string {
  return `${Math.round(MAX_DOCUMENT_SIZE / (1024 * 1024))}MB`;
}
