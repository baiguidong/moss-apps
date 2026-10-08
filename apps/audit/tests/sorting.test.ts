import { describe, expect, it } from 'bun:test';
import { sortRows } from '../src/components/audit-view';

type Row = { id: string; name: string; count: number | null };

const rows: Row[] = [
  { id: 'b', name: '工具 10', count: 2 },
  { id: 'a', name: '工具 2', count: 8 },
  { id: 'c', name: '工具 1', count: null },
];

describe('local audit sorting', () => {
  it('sorts text with numeric collation', () => {
    const sorted = sortRows(rows, { key: 'name', direction: 'asc' }, (row, key) => row[key as keyof Row]);
    expect(sorted.map((row) => row.id)).toEqual(['c', 'a', 'b']);
  });

  it('sorts numbers descending and keeps missing values last', () => {
    const sorted = sortRows(rows, { key: 'count', direction: 'desc' }, (row, key) => row[key as keyof Row]);
    expect(sorted.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});
