/** Player-facing intersection name. Ids are letters (A, B, C); legacy generated ids like "k1" become "1". */
export function intersectionDisplayName(id: string | null | undefined): string {
  if (!id) return '';
  const m = /^k(\d+)$/i.exec(id);
  return m ? m[1] : id;
}
