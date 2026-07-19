/**
 * Minimal, dependency-free CSV parser (matches lib/compliance/period.ts's
 * "pure, no external library" style) — used for Phase 12.6's bulk client
 * import. Handles quoted fields, embedded commas, embedded quotes ("" ->
 * literal "), and both \n and \r\n line endings. NOT a full RFC 4180
 * implementation — a quoted field cannot contain a literal newline — which
 * is fine for the flat, single-line client-import rows this exists for; a
 * spreadsheet export of tabular client data never produces that shape.
 */

export interface ParsedCsv {
  /** Lowercased, trimmed header cells, in file order. */
  headers: string[];
  /** One object per data row, keyed by the lowercased header. Missing
   *  trailing cells on a short row read as ''. */
  rows: Record<string, string>[];
}

function splitLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    rows.push(row);
  }
  return { headers, rows };
}
