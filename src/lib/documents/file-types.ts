/**
 * Server-side upload type validation by CONTENT, not by what the client says
 * (app-layer security audit, finding M1 — docs/verification/app-layer-security-audit.md).
 *
 * Why content and not extension/MIME: both `file.name` and `file.type` come
 * from the browser's multipart part and are trivially forged. Before this
 * module, `uploadDocumentAction` passed `file.type` straight through to
 * Supabase Storage as the object's stored content type, and signed URLs serve
 * that value back with no Content-Disposition — so an `.pdf` file declared as
 * `text/html` rendered and executed in whoever clicked Download. A portal
 * `client_user` (the least-trusted role, and the one that needs NO permission
 * key to upload) could plant it for staff. RLS cannot see any of this: it
 * governs which rows and which storage paths a caller may touch, never what
 * is inside the bytes.
 *
 * ALLOW-LIST, never a deny-list. A deny-list of dangerous types is a losing
 * game (`.xhtml`, `.svgz`, `.mhtml`, `.htm`, whatever a browser learns to
 * render next year); an allow-list of the formats a CA firm actually
 * exchanges fails closed on everything it has not heard of. HTML and SVG are
 * not on it and cannot be added by a caller.
 *
 * The two layers this module supports, in order of strength:
 *   1. The signature check here — the file's own leading bytes must match a
 *      format on the list.
 *   2. `contentTypeFor()` — the value callers must store on the object and
 *      serve back, derived from the DETECTED type, never from `file.type`.
 * Downloads additionally force `Content-Disposition: attachment` at the
 * signed-URL call sites, so even a format that renders inline cannot.
 *
 * KNOWN AND ACCEPTED LIMITATION: the modern Office formats (docx/xlsx/pptx)
 * are ZIP containers and share one signature, `PK\x03\x04`, with each other
 * and with a plain `.zip`. Signature matching therefore proves "this is a ZIP
 * container" and the declared extension selects among the ZIP-based formats
 * on the list. This is not a hole — a ZIP served as an attachment cannot
 * execute in a browser whatever it is really called — but it is stated
 * plainly rather than papered over: for these three types the extension is
 * load-bearing for LABELLING, never for the allow/deny decision itself.
 */

export interface AllowedFileType {
  /** Canonical extension stored in the object path. */
  ext: string;
  /** The content type the SERVER decides; never `file.type`. */
  contentType: string;
  /** Human label used in the error message listing what is accepted. */
  label: string;
  /**
   * Leading-byte signatures, any of which identifies this family. Empty for
   * text formats, which have none — see `isPlausibleText()`.
   */
  signatures: number[][];
  /** Offset the signature starts at (non-zero for RIFF/ftyp-style headers). */
  signatureOffset?: number;
}

/** `PK\x03\x04` — every modern Office file is a ZIP container. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
/** OLE2 compound document — legacy .doc/.xls/.ppt. */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export const ALLOWED_FILE_TYPES: AllowedFileType[] = [
  {
    ext: 'pdf',
    contentType: 'application/pdf',
    label: 'PDF',
    signatures: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  },
  {
    ext: 'jpg',
    contentType: 'image/jpeg',
    label: 'JPEG',
    signatures: [[0xff, 0xd8, 0xff]],
  },
  {
    ext: 'png',
    contentType: 'image/png',
    label: 'PNG',
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  {
    ext: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word (.docx)',
    signatures: [ZIP_SIGNATURE],
  },
  {
    ext: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel (.xlsx)',
    signatures: [ZIP_SIGNATURE],
  },
  {
    ext: 'pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'PowerPoint (.pptx)',
    signatures: [ZIP_SIGNATURE],
  },
  {
    ext: 'doc',
    contentType: 'application/msword',
    label: 'Word (.doc)',
    signatures: [OLE2_SIGNATURE],
  },
  {
    ext: 'xls',
    contentType: 'application/vnd.ms-excel',
    label: 'Excel (.xls)',
    signatures: [OLE2_SIGNATURE],
  },
  {
    // No signature exists for CSV. Kept on the list because CA firms genuinely
    // exchange them (bank statements, TDS working files, GSTR downloads); made
    // safe by isPlausibleText() below plus the forced attachment disposition.
    ext: 'csv',
    contentType: 'text/csv',
    label: 'CSV',
    signatures: [],
  },
  {
    ext: 'txt',
    contentType: 'text/plain',
    label: 'Plain text',
    signatures: [],
  },
];

/** For the "accepted formats" hint and the `accept` attribute on the input. */
export const ACCEPTED_EXTENSIONS = ALLOWED_FILE_TYPES.map((t) => `.${t.ext}`);
export const ACCEPTED_LABEL = 'PDF, JPEG, PNG, Word, Excel, PowerPoint, CSV, or plain text';
/** Extra extensions that map onto a canonical entry above. */
const EXTENSION_ALIASES: Record<string, string> = { jpeg: 'jpg' };

function extensionOf(fileName: string): string {
  const parts = fileName.toLowerCase().split('.');
  if (parts.length < 2) return '';
  const raw = parts[parts.length - 1].trim();
  return EXTENSION_ALIASES[raw] ?? raw;
}

function startsWithSignature(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

/**
 * Text formats have no signature, so "is this really text" is the check that
 * has to do the work. Two rules:
 *   - No NUL byte in the sampled prefix (binary masquerading as .csv).
 *   - The first non-whitespace character must not be `<`. This is the specific
 *     rejection that matters: it blocks `<html`, `<svg`, `<!DOCTYPE`, `<?xml`
 *     — i.e. exactly the shapes a browser might be persuaded to render — while
 *     leaving every real CSV/TXT alone, since neither format legitimately
 *     begins with an angle bracket.
 */
function isPlausibleText(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x00) return false;
  }
  let i = 0;
  // Skip a UTF-8 BOM, which Excel writes on CSV exports.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) {
    i++;
  }
  if (i < bytes.length && bytes[i] === 0x3c /* '<' */) return false;
  return true;
}

export interface DetectedType {
  ext: string;
  contentType: string;
}

export type DetectFileTypeResult =
  | { ok: true; type: DetectedType }
  | { ok: false; error: string };

const REJECTION_MESSAGE =
  `This file type isn't accepted. Please upload a ${ACCEPTED_LABEL} file.`;

/**
 * The single decision point. Reads the leading bytes of the file and returns
 * the SERVER's verdict on what it is — or a rejection. Callers must use the
 * returned `ext`/`contentType` and discard `file.name`'s extension and
 * `file.type` entirely.
 *
 * Deliberately returns one generic message for every rejection reason: a
 * caller does not need to know whether it failed on signature, extension, or
 * text-sniffing, and telling them would just be a tuning oracle.
 */
export async function detectFileType(file: File): Promise<DetectFileTypeResult> {
  const declaredExt = extensionOf(file.name);
  if (!declaredExt) return { ok: false, error: REJECTION_MESSAGE };

  const candidate = ALLOWED_FILE_TYPES.find((t) => t.ext === declaredExt);
  if (!candidate) return { ok: false, error: REJECTION_MESSAGE };

  // 4096 bytes is far more than any signature needs; the surplus is for
  // isPlausibleText()'s NUL scan to have a meaningful sample.
  const prefix = new Uint8Array(await file.slice(0, 4096).arrayBuffer());

  if (candidate.signatures.length === 0) {
    // Text family: no signature to match, so content-plausibility IS the check.
    if (!isPlausibleText(prefix)) return { ok: false, error: REJECTION_MESSAGE };
    return { ok: true, type: { ext: candidate.ext, contentType: candidate.contentType } };
  }

  const matches = candidate.signatures.some((sig) =>
    startsWithSignature(prefix, sig, candidate.signatureOffset ?? 0)
  );
  if (!matches) return { ok: false, error: REJECTION_MESSAGE };

  return { ok: true, type: { ext: candidate.ext, contentType: candidate.contentType } };
}
