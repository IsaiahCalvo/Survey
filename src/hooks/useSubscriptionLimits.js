/**
 * useSubscriptionLimits.js — tier-based quota checks against current usage.
 *
 * Exports TIER_LIMITS (free/pro/enterprise/developer caps + feature lists) and
 * useSubscriptionLimits(): reads the user's tier from useAuth, fetches project/
 * document/storage usage from Supabase, and returns guard helpers
 * (canCreateProject, canUploadDocument, canCreateTemplate/Region, hasFeatureAccess)
 * plus usage-percentage / remaining-quota / formatBytes utilities.
 *
 * Storage usage is GROUND TRUTH (KAL-390). It comes from the
 * get_actual_storage_usage() RPC, which sums the real object sizes in the
 * user's folder of the `documents` storage bucket. It deliberately does NOT
 * come from user_subscriptions.storage_used_bytes: that column is a running
 * total of client-supplied documents.file_size values maintained by triggers on
 * the documents table, so it drifts from reality (measured 38.6% low on
 * production, 2026-08-19) and would show the user a figure with no relation to
 * the bytes they are actually storing. See
 * supabase/migrations/20260819010000_kal390_usage_meter_ground_truth.sql.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseAvailable } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { coalesceRead, invalidateCoalescedRead } from './requestCoalescer.js';

/**
 * Subscription tier limits
 * These should match the database functions get_storage_limit(), get_project_limit(), etc.
 */
const TIER_LIMITS = {
  free: {
    projects: 1,
    documents: 5,
    storage: 100 * 1024 * 1024, // 100 MB in bytes
    features: ['basic_annotations', 'pdf_viewer', 'layers'],
  },
  pro: {
    projects: 999999, // Unlimited
    documents: 999999, // Unlimited
    storage: 10 * 1024 * 1024 * 1024, // 10 GB in bytes
    features: [
      'basic_annotations', 'pdf_viewer', 'layers',
      'survey_tools', 'templates', 'regions', 'excel_export',
      'onedrive', 'advanced_tools', 'page_operations',
      'unlimited_projects', 'unlimited_documents'
    ],
  },
  enterprise: {
    projects: 999999, // Unlimited
    documents: 999999, // Unlimited
    storage: 1024 * 1024 * 1024 * 1024, // 1 TB in bytes
    features: [
      'basic_annotations', 'pdf_viewer', 'layers',
      'survey_tools', 'templates', 'regions', 'excel_export',
      'onedrive', 'advanced_tools', 'page_operations',
      'unlimited_projects', 'unlimited_documents',
      'sso', 'priority_support', 'custom_branding'
    ],
  },
  developer: {
    projects: 999999,
    documents: 999999,
    storage: 100 * 1024 * 1024 * 1024, // 100 GB for testing
    features: ['all'],
  },
};

/**
 * Hook for checking subscription limits and current usage
 * Provides real-time validation before performing operations
 */
const EMPTY_USAGE = Object.freeze({ projects: 0, documents: 0, storage: 0 });

export const useSubscriptionLimits = () => {
  const { user, tier: userTier } = useAuth();
  const userId = user?.id ?? null;
  const scopeRef = useRef(null);
  if (!scopeRef.current || scopeRef.current.userId !== userId) {
    scopeRef.current = { userId, generation: 0, active: true };
  }
  const scope = scopeRef.current;
  const [snapshot, setSnapshot] = useState(null);
  // Mask the old actor's state during render, before effect cleanup/setup runs.
  const currentSnapshot = snapshot?.scope === scope ? snapshot : null;
  const usage = currentSnapshot?.usage ?? EMPTY_USAGE;
  const loading = currentSnapshot?.loading ?? Boolean(userId);
  const error = currentSnapshot?.error ?? null;
  const limits = TIER_LIMITS[userTier] || TIER_LIMITS.free;

  // Fetch current usage from database. `coalesce:true` (boot) shares the
  // project-count + document-count + storage trio across the multiple live
  // useSubscriptionLimits consumers (Dashboard + UsageIndicator). The exposed
  // `refetch` calls with the default (bypass) so a deliberate refresh always
  // hits the network. See KAL-251.
  //
  // Call frequency matters here because the storage read is now a live scan:
  // get_actual_storage_usage() is STABLE and does a `LIKE` prefix match over
  // storage.objects, so it is more expensive than reading a counter column.
  // It is NOT in a render loop — this runs once per signed-in user (the effect
  // below keys on the user id, not the user object, so AuthContext re-emitting
  // an equal user does not refire it), boot calls are coalesced across the
  // Dashboard and UsageIndicator consumers, and the only other caller is the
  // explicit refresh in Dashboard. Nothing polls it.
  const fetchUsage = useCallback(async ({ coalesce = false } = {}) => {
    if (scopeRef.current !== scope || !scope.active) return;
    const generation = ++scope.generation;
    const isCurrent = () => scopeRef.current === scope && scope.active && scope.generation === generation;
    const publish = (patch) => {
      if (!isCurrent()) return;
      setSnapshot(previous => {
        if (!isCurrent()) return previous;
        const base = previous?.scope === scope ? previous : { scope, usage: EMPTY_USAGE, error: null };
        return { ...base, ...patch };
      });
    };
    if (!userId || !isSupabaseAvailable()) {
      publish({ loading: false });
      return;
    }

    try {
      publish({ loading: true });

      const runUsageQuery = async () => {
        // These three reads are independent — run them concurrently instead of
        // as a 3-round-trip waterfall. Supabase resolves (never rejects) with
        // {data,error}, so error checks below preserve the original throw order.
        const [projectRes, documentRes, storageRes] = await Promise.all([
          // Match the insert policies: user_archived_at is a separate UI state.
          supabase.from('projects').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('archived', false),
          supabase.from('documents').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('archived', false),
          // Ground truth: real bytes in the user's storage folder. The RPC is
          // SECURITY DEFINER and self-scopes to auth.uid(), so p_user_id is
          // only a readability aid — a caller cannot read anyone else's total.
          supabase.rpc('get_actual_storage_usage', { p_user_id: userId }),
        ]);

        if (projectRes.error) throw projectRes.error;
        if (documentRes.error) throw documentRes.error;
        // No silent fallback to user_subscriptions.storage_used_bytes if this
        // fails. That counter is known-wrong; showing it would be worse than
        // surfacing the error, because the user cannot tell a stale meter from
        // a broken one.
        if (storageRes.error) throw storageRes.error;

        const projectCount = projectRes.count;
        const documentCount = documentRes.count;
        if (!Number.isSafeInteger(projectCount) || projectCount < 0) {
          throw new Error('Invalid project usage count');
        }
        if (!Number.isSafeInteger(documentCount) || documentCount < 0) {
          throw new Error('Invalid document usage count');
        }
        const rawStorage = storageRes.data;
        const storageBytes = typeof rawStorage === 'number'
          ? rawStorage
          : typeof rawStorage === 'string' && /^\d+$/.test(rawStorage) ? Number(rawStorage) : NaN;
        if (!Number.isFinite(storageBytes) || !Number.isInteger(storageBytes) || storageBytes < 0) {
          throw new Error('Invalid storage usage total');
        }

        return {
          projects: projectCount,
          documents: documentCount,
          // The RPC returns a bigint, which PostgREST may serialize as a
          // string once it exceeds 2^53 — coerce before it reaches the meter.
          storage: storageBytes,
        };
      };

      const next = coalesce
        ? await coalesceRead(`usage:${userId}`, runUsageQuery)
        : await runUsageQuery();

      publish({ usage: next, error: null });
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Error fetching usage:', err);
      publish({ error: err.message });
    } finally {
      publish({ loading: false });
    }
  }, [scope, userId]);

  useEffect(() => {
    scope.active = true;
    fetchUsage({ coalesce: true });
    return () => {
      scope.active = false;
      scope.generation += 1;
      // An A -> B -> A switch must not rejoin a read begun for the old A
      // scope. Same-actor Strict Mode replay still shares the boot request.
      if (scopeRef.current !== scope && scope.userId) {
        invalidateCoalescedRead(`usage:${scope.userId}`);
      }
    };
  }, [fetchUsage, scope]);

  /**
   * Check if user can create a new project
   * @returns {Object} { allowed: boolean, reason: string }
   */
  const canCreateProject = useCallback(() => {
    if (usage.projects < limits.projects) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `You've reached the limit of ${limits.projects} project${limits.projects > 1 ? 's' : ''} for your ${userTier || 'free'} tier. Upgrade to Pro for unlimited projects.`,
    };
  }, [usage.projects, limits.projects, userTier]);

  /**
   * Check if user can upload a new document
   * @param {number} fileSize - Size of file in bytes
   * @returns {Object} { allowed: boolean, reason: string }
   */
  const canUploadDocument = useCallback((fileSize = 0) => {
    // Check document count limit
    if (usage.documents >= limits.documents) {
      return {
        allowed: false,
        reason: `You've reached the limit of ${limits.documents} document${limits.documents > 1 ? 's' : ''} for your ${userTier || 'free'} tier. Upgrade to Pro for unlimited documents.`,
      };
    }

    // Check storage limit
    const newTotal = usage.storage + fileSize;
    if (newTotal > limits.storage) {
      const usedMB = (usage.storage / (1024 * 1024)).toFixed(1);
      const limitMB = (limits.storage / (1024 * 1024)).toFixed(0);
      const fileMB = (fileSize / (1024 * 1024)).toFixed(1);

      return {
        allowed: false,
        reason: `Not enough storage. You're using ${usedMB}MB of ${limitMB}MB. This file (${fileMB}MB) would exceed your limit. Upgrade to Pro for 10GB of storage.`,
      };
    }

    return { allowed: true };
  }, [usage.documents, usage.storage, limits.documents, limits.storage, userTier]);

  /**
   * Check if user can create a template
   * @returns {Object} { allowed: boolean, reason: string }
   */
  const canCreateTemplate = useCallback(() => {
    if (limits.features.includes('templates') || limits.features.includes('all')) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Templates are a Pro feature. Upgrade to Pro to create custom survey templates.`,
    };
  }, [limits.features]);

  /**
   * Check if user can create a region/space
   * @returns {Object} { allowed: boolean, reason: string }
   */
  const canCreateRegion = useCallback(() => {
    if (limits.features.includes('regions') || limits.features.includes('all')) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Regions are a Pro feature. Upgrade to Pro to use advanced survey regions.`,
    };
  }, [limits.features]);

  /**
   * Check if user has access to a specific feature
   * @param {string} featureName - Feature to check
   * @returns {boolean}
   */
  const hasFeatureAccess = useCallback((featureName) => {
    return limits.features.includes(featureName) || limits.features.includes('all');
  }, [limits.features]);

  /**
   * Get usage percentage for a metric
   * @param {string} metric - 'projects', 'documents', or 'storage'
   * @returns {number} Percentage (0-100)
   */
  const getUsagePercentage = useCallback((metric) => {
    const unlimitedCount = (metric === 'projects' || metric === 'documents') && limits[metric] >= 999999;
    if (!limits[metric] || unlimitedCount) return 0;
    return Math.min(100, (usage[metric] / limits[metric]) * 100);
  }, [usage, limits]);

  /**
   * Format bytes to human-readable string
   * @param {number} bytes
   * @returns {string}
   */
  const formatBytes = useCallback((bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i >= 2 ? 1 : 0)} ${sizes[i]}`;
  }, []);

  /**
   * Get remaining quota for a metric
   * @param {string} metric - 'projects', 'documents', or 'storage'
   * @returns {number}
   */
  const getRemainingQuota = useCallback((metric) => {
    if ((metric === 'projects' || metric === 'documents') && limits[metric] >= 999999) return 999999;
    return Math.max(0, limits[metric] - usage[metric]);
  }, [usage, limits]);

  return {
    usage,
    limits,
    loading,
    error,
    canCreateProject,
    canUploadDocument,
    canCreateTemplate,
    canCreateRegion,
    hasFeatureAccess,
    getUsagePercentage,
    formatBytes,
    getRemainingQuota,
    // Zero-arg wrapper (matches useDocuments/useTemplates) so a deliberate
    // refetch always bypasses the coalescer and no caller can pass coalesce:true
    // through the public surface.
    refetch: () => fetchUsage(),
    tier: userTier || 'free',
  };
};
