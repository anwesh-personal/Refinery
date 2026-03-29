import analyzeList from './analyze-list.js';
import compareLists from './compare-lists.js';
import findDuplicates from './find-duplicates.js';
import mergeLists from './merge-lists.js';
import profileColumns from './profile-columns.js';

// ═══════════════════════════════════════════════════════════
// Analysis Tools — Auto-export all analysis tool definitions
// Add new tools here and they'll be auto-registered
// ═══════════════════════════════════════════════════════════

export const analysisTools = [
  analyzeList,
  compareLists,
  findDuplicates,
  mergeLists,
  profileColumns,
];

export { analyzeList, compareLists, findDuplicates, mergeLists, profileColumns };
