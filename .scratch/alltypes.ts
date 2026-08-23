import { fetchList } from '../ingest/vis.js';

async function main() {
  const rows = await fetchList({
    type: 'GetBeachTournamentList',
    fields: ['No', 'Name', 'Title', 'Season', 'Type', 'OrganizerType'],
    itemTag: 'BeachTournament',
  });
  const tally = new Map<string, { n: number; from: number; to: number; names: string[] }>();
  for (const r of rows) {
    if (r.OrganizerType !== '1') continue;
    const t = r.Type ?? '?';
    const s = Number(r.Season);
    const e = tally.get(t) ?? { n: 0, from: 9999, to: 0, names: [] };
    e.n++;
    if (Number.isFinite(s)) { e.from = Math.min(e.from, s); e.to = Math.max(e.to, s); }
    if (e.names.length < 3) e.names.push(`${r.Name ?? r.Title ?? '?'} ${r.Season ?? ''}`);
    tally.set(t, e);
  }
  console.log('ALL Type values with OrganizerType=1:\n');
  for (const [t, e] of [...tally].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`Type ${t.padStart(2)}  ${String(e.n).padStart(4)}  ${e.from}-${e.to}  ${e.names.join(' | ').slice(0, 90)}`);
  }
}
main();
