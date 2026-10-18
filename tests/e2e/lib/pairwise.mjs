export function allPairs(factors) {
  const names = Object.keys(factors);
  const uncovered = new Set();
  const key = (a, va, b, vb) => `${a}=${va}|${b}=${vb}`;
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      for (const va of factors[names[i]]) for (const vb of factors[names[j]]) uncovered.add(key(names[i], va, names[j], vb));
  const rows = [];
  while (uncovered.size) {
    let best = null;
    let bestScore = -1;
    for (let attempt = 0; attempt < 60; attempt++) {
      const row = {};
      for (const name of names) {
        const options = factors[name];
        let pick = options[(attempt + rows.length) % options.length];
        let score = -1;
        for (const v of options) {
          let s = 0;
          for (const other of Object.keys(row)) {
            const [a, b] = names.indexOf(other) < names.indexOf(name) ? [other, name] : [name, other];
            const k = a === other ? key(a, row[other], b, v) : key(a, v, b, row[other]);
            if (uncovered.has(k)) s++;
          }
          if (s > score || (s === score && (attempt * 7 + options.indexOf(v)) % 3 === 0)) [score, pick] = [s, v];
        }
        row[name] = pick;
      }
      let total = 0;
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (uncovered.has(key(names[i], row[names[i]], names[j], row[names[j]]))) total++;
      if (total > bestScore) [best, bestScore] = [row, total];
    }
    if (bestScore <= 0) {
      const [first] = uncovered;
      const [[a, va], [b, vb]] = first.split('|').map((part) => part.split('='));
      const row = Object.fromEntries(names.map((n) => [n, factors[n][0]]));
      row[a] = factors[a].find((v) => String(v) === va);
      row[b] = factors[b].find((v) => String(v) === vb);
      best = row;
    }
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) uncovered.delete(key(names[i], best[names[i]], names[j], best[names[j]]));
    rows.push(best);
  }
  return rows;
}
