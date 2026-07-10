import type { CompliancePeriodicity, ComplianceType, TaskPeriodType } from '@/lib/types';

/**
 * Indian-FY-aware period + due-date computation for statutory task
 * generation. Interprets the `due_day_rule` JSONB convention documented in
 * supabase/ca-firm/schema.sql §10: {due_day, months_after_period_end} for
 * monthly/quarterly types, {due_day, due_month} for a fixed annual date.
 * Government due-date extensions are NOT modeled — see project_context.md §0.
 *
 * FY runs Apr 1 – Mar 31; labelled '2026-27' for the FY starting April 2026.
 * Quarters are FY-aligned: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar.
 */

export interface Period {
  financialYear: string;
  periodType: TaskPeriodType;
  periodKey: string;
  /** [year, month(1-12)] of the period's own end — used to derive due dates. */
  periodEnd: { year: number; month: number };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** FY start year containing `date` (e.g. Feb 2027 -> 2026, for FY 2026-27). */
export function fyStartYear(date: Date): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1; // 1-12
  return m >= 4 ? y : y - 1;
}

export function fyLabel(startYear: number): string {
  return `${startYear}-${pad2((startYear + 1) % 100)}`;
}

/** FY-aligned quarter number (1-4) for a given calendar month (1-12). */
function fyQuarter(month: number): number {
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10 && month <= 12) return 3;
  return 4; // Jan-Mar
}

/** Last calendar month (1-12) + its FY-relative start year of a quarter. */
function quarterEnd(fyStart: number, quarter: number): { year: number; month: number } {
  switch (quarter) {
    case 1:
      return { year: fyStart, month: 6 };
    case 2:
      return { year: fyStart, month: 9 };
    case 3:
      return { year: fyStart, month: 12 };
    default:
      return { year: fyStart + 1, month: 3 };
  }
}

/** The "current" period for a given periodicity, as of `referenceDate`. */
export function currentPeriod(periodicity: CompliancePeriodicity, referenceDate: Date): Period {
  const fyStart = fyStartYear(referenceDate);
  const financialYear = fyLabel(fyStart);
  const y = referenceDate.getFullYear();
  const m = referenceDate.getMonth() + 1;

  if (periodicity === 'monthly') {
    return {
      financialYear,
      periodType: 'monthly',
      periodKey: `${y}-${pad2(m)}`,
      periodEnd: { year: y, month: m },
    };
  }
  if (periodicity === 'quarterly') {
    const q = fyQuarter(m);
    const end = quarterEnd(fyStart, q);
    return {
      financialYear,
      periodType: 'quarterly',
      periodKey: `${financialYear}-Q${q}`,
      periodEnd: end,
    };
  }
  if (periodicity === 'annual') {
    return {
      financialYear,
      periodType: 'annual',
      periodKey: financialYear,
      periodEnd: { year: fyStart + 1, month: 3 },
    };
  }
  // 'event' periodicity has no calendar period — callers should not reach here
  // for generation (event-type compliance isn't calendar-generated).
  return {
    financialYear,
    periodType: 'event',
    periodKey: `${financialYear}-event`,
    periodEnd: { year: fyStart + 1, month: 3 },
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function toDateString(year: number, month: number, day: number): string {
  const clampedDay = Math.min(day, daysInMonth(year, month));
  return `${year}-${pad2(month)}-${pad2(clampedDay)}`;
}

/** Computes the due date for a compliance type given the period it generated
 *  for. Returns null if due_day_rule is missing the fields it needs (caller
 *  should treat that as "cannot compute, skip"). */
export function computeDueDate(complianceType: ComplianceType, period: Period): string | null {
  const rule = complianceType.due_day_rule || {};

  if (complianceType.periodicity === 'annual') {
    if (typeof rule.due_day !== 'number' || typeof rule.due_month !== 'number') return null;
    // First occurrence of {due_month, due_day} strictly after the FY end
    // (period.periodEnd for annual = FY end, month 3 of fyStart+1).
    const fyEndYear = period.periodEnd.year;
    const dueYear = rule.due_month <= 3 ? fyEndYear + 1 : fyEndYear;
    return toDateString(dueYear, rule.due_month, rule.due_day);
  }

  if (typeof rule.due_day !== 'number' || typeof rule.months_after_period_end !== 'number') {
    return null;
  }
  let { year, month } = period.periodEnd;
  month += rule.months_after_period_end;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return toDateString(year, month, rule.due_day);
}
