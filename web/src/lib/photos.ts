/** Helpers for the tournament photo strip (`components/TournamentPhotos.tsx`). */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "14 Jul 2019, 17:28", as FIVB recorded it. No time zone is converted: VIS
 * gives none, and the clock it was taken by is the venue's.
 */
export function formatTaken(takenAt: string | null): string | null {
  const m = takenAt && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(takenAt);
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}`;
}
