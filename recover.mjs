import fs from 'fs';

const distContent = fs.readFileSync('dist/web/assets/index-9KGhTZ3U.js', 'utf8');

const patterns = [
  'title:', 'description:', 'field:', 'inputKind:', 'unit:', 'placeholder:',
  'investorName:', 'investedEnterprises:', 'capitalCostRate:', 'investmentTotal:',
  'investmentHorizon:', 'riskAppetite:', 'industryInterest:', 'focusTopic:', 'notes:',
  'fileName:', 'mimeType:', 'content:'
];

const extracted = {};
for (const p of patterns) {
  const regex = new RegExp(p + '"([^"]*)"', 'g');
  const values = new Set();
  let m;
  while ((m = regex.exec(distContent)) !== null) {
    values.add(m[1]);
  }
  extracted[p] = [...values];
}

for (const [key, values] of Object.entries(extracted)) {
  if (values.length > 0) {
    console.log(key);
    for (const v of values) {
      console.log('  "' + v + '"');
    }
  }
}
