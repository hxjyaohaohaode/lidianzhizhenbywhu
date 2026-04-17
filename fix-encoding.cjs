const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/web/chart-system.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Fix common corrupted patterns - these are mojibake from double-encoding issues
const replacements = [
  // Fix unclosed string patterns like "高风险 : " -> "高风险" : "
  [/"高风险 :\s*"/g, '"高风险" : "'],
  [/"良好 :\s*"/g, '"良好" : "'],
  [/"观察 :\s*"/g, '"观察" : "'],
  [/"中等 :\s*"/g, '"中等" : "'],
  
  // Fix broken template literal patterns where ${ was corrupted to ?{
  [/\?\{/g, '${'],
  
  // Fix broken Chinese status labels
  [/鐘舵€\?/g, '状态'],
  [/鐘舵€?/g, '状态'],
  [/澶囨敞/g, '备注'],
  [/灞傜骇/g, '层级'],
  [/璐ｄ换/g, '责任'],
  [/涓讳綋/g, '主体'],
  [/鎸囨爣/g, '指标'],
  
  // Fix broken comparison patterns
  [/鈭\?\s*:\s*\+"\}/g, '\\u2228" : "+"}'],
];

let changed = true;
let iterations = 0;
while (changed && iterations < 10) {
  changed = false;
  iterations++;
  for (const [pattern, replacement] of replacements) {
    const newContent = content.replace(pattern, replacement);
    if (newContent !== content) {
      content = newContent;
      changed = true;
    }
  }
}

// Additional targeted fixes for specific broken lines
content = content.replace(
  /label=\{childRow\.status === "good" \? "良好" : childRow\.status === "watch" \? "观察" : childRow\.status === "risk" \? "高风险 : "中等"\}/g,
  'label={childRow.status === "good" ? "良好" : childRow.status === "watch" ? "观察" : childRow.status === "risk" ? "高风险" : "中等"}'
);

content = content.replace(
  /row\.status === "good" \? "良好" : row\.status === "watch" \? "观察" : row\.status === "risk" \? "高风险 : "中等"/g,
  'row.status === "good" ? "良好" : row.status === "watch" ? "观察" : row.status === "risk" ? "高风险" : "中等"'
);

content = content.replace(
  /data\.status === "good" \? "良好" : data\.status === "watch" \? "观察" : data\.status === "risk" \? "高风险 : "中等"/g,
  'data.status === "good" ? "良好" : data.status === "watch" ? "观察" : data.status === "risk" ? "高风险" : "中等"'
);

// Fix all remaining "高风险 : " patterns (unclosed quotes)
content = content.replace(/"高风险 :\s*"/g, '"高风险" : "');

fs.writeFileSync(filePath, content, 'utf8');
console.log(`Applied fixes (${iterations} iterations)`);
console.log(`File size: ${content.length} chars`);
