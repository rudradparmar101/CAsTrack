/**
 * The ONE way this app mints a document download URL (app-layer security
 * audit, finding M1).
 *
 * Before this module, five call sites each did
 * `createSignedUrl(path, 3600)` with no download option. That makes Supabase
 * serve the object with its stored content type and NO Content-Disposition
 * header at all — verified live during the audit, not assumed — so anything a
 * browser knows how to render renders inline, in the victim's browser, on the
 * Supabase project origin. Passing `download` flips the response to
 * `Content-Disposition: attachment`, so nothing renders inline regardless of
 * content type. That is the half of M1 that protects documents ALREADY in the
 * bucket, which the upload-side allow-list cannot retroactively fix.
 *
 * Centralised deliberately: a sixth call site that forgets the option would
 * silently reopen the finding, and there is no test that would catch it.
 * Import this, never `createSignedUrl` directly.
 */

const DOCUMENTS_BUCKET = 'client-documents';
const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour, unchanged from the original sites.

/**
 * Make a stored file name safe to hand back as the download filename.
 * `file_name` is the raw client-supplied name (kept as display metadata), so
 * it can contain quotes, newlines, or path separators. Supabase encodes the
 * value into the Content-Disposition it generates, but stripping the
 * header-breaking characters here means correctness does not depend on that.
 */
function safeDownloadName(fileName: string | null | undefined): string {
  const cleaned = (fileName ?? '')
    .replace(/[\r\n"\\]/g, '')
    .replace(/[/\\]/g, '_')
    .trim();
  return cleaned || 'document';
}

type StorageCapable = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
        options?: { download?: string | boolean }
      ) => PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
};

/**
 * Signed download URL that always serves as an attachment.
 * Returns null when the caller cannot sign the path (RLS) — same shape the
 * previous inline call sites already handled.
 */
export async function createDocumentDownloadUrl(
  supabase: StorageCapable,
  filePath: string,
  fileName: string | null | undefined
): Promise<string | null> {
  const { data } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS, {
      download: safeDownloadName(fileName),
    });
  return data?.signedUrl ?? null;
}
