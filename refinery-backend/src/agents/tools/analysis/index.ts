import analyzeList from './analyze-list.js';
import compareLists from './compare-lists.js';
import findDuplicates from './find-duplicates.js';
import mergeLists from './merge-lists.js';
import profileColumns from './profile-columns.js';
import getAgentActivity from './get-agent-activity.js';

// ═══════════════════════════════════════════════════════════
// Analysis Tools — Auto-export all tool definitions
// Add new tools here → auto-registered in registry
// ═══════════════════════════════════════════════════════════

export const analysisTools = [
  analyzeList,
  compareLists,
  findDuplicates,
  mergeLists,
  profileColumns,
  getAgentActivity,
];
