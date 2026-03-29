import analyzeList from './analyze-list.js';
import compareLists from './compare-lists.js';
import findDuplicates from './find-duplicates.js';

// ═══════════════════════════════════════════════════════════
// Analysis Tools — Auto-export all analysis tool definitions
// Add new tools here and they'll be auto-registered
// ═══════════════════════════════════════════════════════════

export const analysisTools = [
  analyzeList,
  compareLists,
  findDuplicates,
];

export { analyzeList, compareLists, findDuplicates };
