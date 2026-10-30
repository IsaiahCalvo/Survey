// sheet-sync: live two-way sync between a survey and a Google Sheet, run on
// the server so phones, the web and the desktop app all sync. The logic lives
// in ../_shared/sheetSync/service.js (node tests drive it against the local
// database and a fake Google); this file only hands it Deno's pieces.
//
// GET  .../sheet-sync/oauth/callback   Google's consent page comes back here.
// POST .../sheet-sync { action, ... }  status | connect | disconnect | link |
//                                      sync | choose | unlink (Bearer JWT).
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import * as Y from 'npm:yjs@13.6.30';
import { handleSheetSync } from '../_shared/sheetSync/service.js';
import { isAgentSession } from '../_shared/agentSession.ts';

Deno.serve((req: Request) => handleSheetSync(req, {
  env: Deno.env.toObject(),
  createClient,
  Y,
  isAgentSession,
}));
