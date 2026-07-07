/**
 * Calculate the next due date for a recurring task.
 * Mirrors the SQL function `next_recurrence_date()` defined in
 * supabase/migrations/02_enterprise_features.sql.
 */
export function getNextDueDate(currentDueDate: string, rule: string): string | null {
  const date = new Date(currentDueDate);
  switch (rule) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
    default:
      return null;
  }
  return date.toISOString().split('T')[0];
}
