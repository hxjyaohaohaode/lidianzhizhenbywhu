const fs = require('fs');
const content = fs.readFileSync('src/web/App.original.tsx', 'utf8');
const lines = content.split('\n');

// EnterpriseScreen: lines 3348-4148 (1-indexed)
const entBody = lines.slice(3347, 4148).join('\n');
let cleanedEntBody = entBody;
const dupStart = cleanedEntBody.indexOf('function buildEnterpriseCollectionPayload(');
const dupEnd = cleanedEntBody.indexOf('function EntAna(');
if (dupStart > 0 && dupEnd > 0) {
  cleanedEntBody = cleanedEntBody.substring(0, dupStart) + cleanedEntBody.substring(dupEnd);
}
cleanedEntBody = cleanedEntBody.replace('function AppEnterpriseScreen(', 'export function AppEnterpriseScreen(');
cleanedEntBody = cleanedEntBody.replace(
  'usePortalAuditReport("enterprise", tab === "home" || tab === "ana")',
  'usePortalAuditReport("enterprise", tab === "home" || tab === "ana", currentUserId)'
);
fs.writeFileSync('src/web/components/EnterpriseScreen.body.tsx', cleanedEntBody, 'utf8');
console.log('EnterpriseScreen body extracted:', cleanedEntBody.split('\n').length, 'lines');

// InvestorScreen: lines 4150-6576 (1-indexed)
const invBody = lines.slice(4149, 6576).join('\n');
let cleanedInvBody = invBody;
cleanedInvBody = cleanedInvBody.replace('function AppInvestorScreen(', 'export function AppInvestorScreen(');

// Add role: "investor" as const to API calls
const apiFuncs = ['createInvestorSession', 'deleteCurrentInvestorSession', 'deleteInvestorSessions', 'switchInvestorMode', 'uploadInvestorAttachment', 'streamInvestorAnalysis'];
for (const fn of apiFuncs) {
  const pattern = new RegExp(`await ${fn}\\(\\{\\s*\\n\\s*userId`, 'g');
  cleanedInvBody = cleanedInvBody.replace(pattern, `await ${fn}({\n          role: "investor" as const,\n          userId`);
}

fs.writeFileSync('src/web/components/InvestorScreen.body.tsx', cleanedInvBody, 'utf8');
console.log('InvestorScreen body extracted:', cleanedInvBody.split('\n').length, 'lines');

// MemoryScreen: lines 6577-6963 (1-indexed)
const memBody = lines.slice(6576).join('\n');
let cleanedMemBody = memBody.replace('function MemoryScreen(', 'export function MemoryScreen(');
fs.writeFileSync('src/web/components/MemoryScreen.body.tsx', cleanedMemBody, 'utf8');
console.log('MemoryScreen body extracted:', cleanedMemBody.split('\n').length, 'lines');
