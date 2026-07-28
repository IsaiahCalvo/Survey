import test from 'node:test';
import {
  doesNotMatch,
  match,
} from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260728010000_atomic_invite_email_delivery.sql',
);

test('invite delivery migration atomically claims every invite kind without uncertain-send takeover', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  match(sql, /CREATE TABLE public\.invite_email_deliveries/);
  match(sql, /invite_kind[\s\S]+CHECK[\s\S]+'document'[\s\S]+'project'[\s\S]+'template'/);
  match(sql, /UNIQUE\s*\(invite_kind,\s*invite_id,\s*delivery_version\)/);
  match(sql, /CREATE OR REPLACE FUNCTION public\.claim_invite_email_delivery/);
  match(sql, /INSERT INTO public\.invite_email_deliveries[\s\S]+ON CONFLICT DO NOTHING/);
  doesNotMatch(sql, /claimed_at\s*<=\s*clock_timestamp\(\)\s*-\s*make_interval/);
  doesNotMatch(sql, /attempt_count\s*=\s*attempt_count\s*\+\s*1/);
  match(sql, /v_target_email IS NULL/);
  match(sql, /v_revoked_at IS NOT NULL/);
  match(sql, /v_accepted_at IS NOT NULL/);
  match(sql, /v_expires_at <= clock_timestamp\(\)/);
  match(sql, /email_delivery_version UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
  match(sql, /delivery_version UUID NOT NULL/);
  match(sql, /WHEN 'document'[\s\S]+document_invites/);
  match(sql, /WHEN 'project'[\s\S]+project_invites/);
  match(sql, /WHEN 'template'[\s\S]+template_invites/);
});

test('invite delivery identity is independent of expiry and rotates only on explicit new delivery', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  match(sql, /SELECT i\.id, i\.email_delivery_version, i\.target_email, i\.expires_at/);
  match(sql, /CREATE OR REPLACE FUNCTION public\.rotate_invite_email_delivery/);
  match(sql, /SET email_delivery_version = v_version,[\s\S]+expires_at = v_expires_at/);
  match(sql, /GRANT EXECUTE ON FUNCTION public\.rotate_invite_email_delivery/);
});

test('invite delivery migration completes confirmed sends and releases failed claims only for the claimant', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  match(sql, /CREATE OR REPLACE FUNCTION public\.complete_invite_email_delivery/);
  match(sql, /SET state = 'completed'/);
  match(sql, /WHERE claim_id = p_claim_id[\s\S]+state = 'claimed'/);
  match(sql, /CREATE OR REPLACE FUNCTION public\.release_invite_email_delivery/);
  match(sql, /DELETE FROM public\.invite_email_deliveries[\s\S]+claim_id = p_claim_id[\s\S]+state = 'claimed'/);
  match(sql, /ALTER TABLE public\.invite_email_deliveries ENABLE ROW LEVEL SECURITY/);
  match(sql, /REVOKE ALL ON public\.invite_email_deliveries FROM PUBLIC/);
  match(sql, /GRANT EXECUTE ON FUNCTION public\.claim_invite_email_delivery[\s\S]+TO authenticated/);
});

test('edge wrapper wires atomic RPCs and preserves uncertain transport outcomes', () => {
  const wrapper = fs.readFileSync(
    path.join(repoRoot, 'supabase/functions/send-invite-email/index.ts'),
    'utf8',
  );
  const handler = fs.readFileSync(
    path.join(repoRoot, 'supabase/functions/send-invite-email/handler.js'),
    'utf8',
  );

  match(wrapper, /callerClient\.rpc\('claim_invite_email_delivery'/);
  match(wrapper, /callerClient\.rpc\('complete_invite_email_delivery'/);
  match(wrapper, /callerClient\.rpc\('release_invite_email_delivery'/);
  match(wrapper, /res\.ok && responseBody\?\.success === true/);
  match(wrapper, /status >= 400 && status < 500[\s\S]+definite-failure[\s\S]+uncertain/);
  match(wrapper, /catch \(e\)[\s\S]+outcome: 'uncertain'/);
  match(wrapper, /catch \{[\s\S]+outcome: 'uncertain'/);
  match(handler, /retainUncertainClaim/);
  match(handler, /inviteResult\.outcome === 'uncertain'/);
  match(handler, /fallbackOutcome === 'uncertain'/);
});
