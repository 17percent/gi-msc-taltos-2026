/**
 * A `pg_trgm` hasonlóságának memóriabeli megfelelője a memóriabeli címke-tárhoz (a PostgreSQL-párt a `%` operátor
 * adja). A `pg_trgm` módszere: a szöveget kisbetűsíti, a nem betű/számjegy karaktereknél szavakra bontja, minden
 * szót két szóközzel előre és eggyel hátra tölt ki, és a 3 karakteres szeletek HALMAZÁT képezi; a hasonlóság a közös
 * elemek száma osztva az egyesítés elemszámával. Az ASCII-n kívüli betűk kezelése a szerver területi beállításától
 * függhet: ott az integrációs teszt a mérvadó.
 */
export function trigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word === '') continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) set.add(padded.slice(i, i + 3));
  }
  return set;
}

export function similarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}
