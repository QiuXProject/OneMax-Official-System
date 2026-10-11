import { SCENARIOS, evaluate } from './eval.mjs';

const grid = {
  relativeThreshold: [0.26, 0.34],
  subtractionGain: [0.7, 0.9],
  octaveRatio: [0.45, 0.6],
  onsetBias: [0.0, 0.06, 0.11],
};

const names = Object.keys(grid);
const combos = [];
(function walk(index, current) {
  if (index === names.length) { combos.push({ ...current }); return; }
  for (const value of grid[names[index]]) walk(index + 1, { ...current, [names[index]]: value });
})(0, {});

const rows = [];
for (const params of combos) {
  const results = [];
  for (const [name, scenario] of Object.entries(SCENARIOS)) results.push(await evaluate(name, scenario(), params));
  const avg = results.reduce((acc, r) => acc + r.stats.f1, 0) / results.length;
  const errs = results.map((r) => r.stats.meanOnsetError).filter((v) => v !== null);
  rows.push({
    params,
    avg,
    err: errs.reduce((a, b) => a + b, 0) / errs.length,
    per: results.map((r) => `${r.name}:${r.stats.f1.toFixed(2)}`).join(' '),
  });
}
rows.sort((a, b) => b.avg - a.avg || a.err - b.err);
for (const row of rows.slice(0, 10)) {
  console.log(`F1=${row.avg.toFixed(3)} err=${row.err.toFixed(3)}s ${JSON.stringify(row.params)} | ${row.per}`);
}
