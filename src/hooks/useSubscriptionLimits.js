import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseAvailable } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

/**
 * Subscription tier limits
 * These should match the database functions get_storage_limit(), get_project_limit(), etc.
 */
export const TIER_LIMITS = {
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
export const useSubscriptionLimits = () => {
  const { user, tier: userTier } = useAuth();
  const [usage, setUsage] = useState({
    projects: 0,
    documents: 0,
    storage: 0,
  });
  const [limits, setLimits] = useState(TIER_LIMITS.free);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Update limits when tier changes
  useEffect(() => {
    if (userTier) {
      setLimits(TIER_LIMITS[userTier] || TIER_LIMITS.free);
    }
  }, [userTier]);

  // Fetch current usage from database
  const fetchUsage = useCallback(async () => {
    if (!user || !isSupabaseAvailable()) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch project count
      const { count: projectCount, error: projectError } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      if (projectError) throw projectError;

      // Fetch document count
      const { count: documentCount, error: documentError } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      if (documentError) throw documentError;

      // Fetch storage usage from user_subscriptions table
      const { data: subData, error: subError } = await supabase
        .from('user_subscriptions')
        .select('storage_used_bytes')
        .eq('user_id', user.id)
        .single();

      if (subError && subError.code !== 'PGRST116') throw subError;

      setUsage({
        projects: projectCount || 0,
        documents: documentCount || 0,
        storage: subData?.storage_used_bytes || 0,
      });

      setError(null);
    } catch (err) {
      console.error('Error fetching usage:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

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
    if (!limits[metric] || limits[metric] >= 999999) return 0; // Unlimited
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
    if (limits[metric] >= 999999) return 999999; // Unlimited
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
    refetch: fetchUsage,
    tier: userTier || 'free',
  };
};
