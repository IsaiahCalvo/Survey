// App-side entry to the shared markup tool catalog (kept under
// supabase/functions/_shared so the voice edge function loads the same file).
export {
  ANNOTATION_TOOL_CATALOG,
  GENERAL_AGENT_TOOLS_BEFORE,
  GENERAL_AGENT_TOOLS_AFTER,
  toolGroupByTool,
  agentToolNamesForTools,
  filterToolsForKit,
} from '../../supabase/functions/_shared/annotationToolCatalog.js';
