import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseAvailable } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

// ============================================
// USER SETTINGS HOOKS
// ============================================

export const useUserSettings = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user || !isSupabaseAvailable()) {
      setLoading(false);
      return;
    }

    fetchSettings();
  }, [user]);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      setSettings(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = async (updates) => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      const { data, error } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, ...updates })
        .select()
        .single();

      if (error) throw error;
      setSettings(data);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return { settings, loading, error, updateSettings, refetch: fetchSettings };
};

// ============================================
// PROJECTS HOOKS
// ============================================

export const useProjects = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user || !isSupabaseAvailable()) {
      setLoading(false);
      return;
    }

    fetchProjects();
  }, [user]);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const projectsData = data || [];
      setProjects(projectsData);
      return projectsData; // Return the data so callers can use it immediately
    } catch (err) {
      setError(err.message);
      throw err; // Re-throw so callers can handle errors
    } finally {
      setLoading(false);
    }
  };

  const createProject = async (projectData) => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({ user_id: user.id, ...projectData })
        .select()
        .single();

      if (error) throw error;
      setProjects([data, ...projects]);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateProject = async (id, updates) => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      setProjects(projects.map((p) => (p.id === id ? data : p)));
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteProject = async (id) => {
    try {
      const { error } = await supabase.from('projects').delete().eq('id', id);

      if (error) throw error;
      setProjects(projects.filter((p) => p.id !== id));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return {
    projects,
    loading,
    error,
    createProject,
    updateProject,
    deleteProject,
    refetch: fetchProjects,
  };
};

// ============================================
// DOCUMENTS HOOKS
// ============================================

export const useDocuments = (projectId = null) => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // console.log('useDocuments render. projectId:', projectId, 'documents count:', documents.length);

  useEffect(() => {
    if (!user || !isSupabaseAvailable()) {
      setLoading(false);
      return;
    }

    fetchDocuments();
  }, [user, projectId]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('documents')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (projectId) {
        query = query.eq('project_id', projectId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setDocuments(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createDocument = async (documentData) => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      const { data, error } = await supabase
        .from('documents')
        .insert({ user_id: user.id, ...documentData })
        .select()
        .single();

      if (error) throw error;
      console.log('createDocument success, updating state with:', data);
      setDocuments([data, ...documents]);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateDocument = async (id, updates) => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      setDocuments(documents.map((d) => (d.id === id ? data : d)));
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteDocument = async (id) => {
    try {
      const { error } = await supabase.from('documents').delete().eq('id', id);

      if (error) throw error;
      setDocuments(documents.filter((d) => d.id !== id));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateLastOpened = async (id) => {
    try {
      await supabase
        .from('documents')
        .update({ last_opened_at: new Date().toISOString() })
        .eq('id', id);
    } catch (err) {
      console.error('Error updating last opened:', err);
    }
  };

  return {
    documents,
    loading,
    error,
    createDocument,
    updateDocument,
    deleteDocument,
    updateLastOpened,
    refetch: fetchDocuments,
  };
};

// ============================================
// TEMPLATES HOOKS
// ============================================

export const useTemplates = () => {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user || !isSupabaseAvailable()) {
      setLoading(false);
      return;
    }

    fetchTemplates();
  }, [user]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('templates')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createTemplate = async (templateData) => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      const { data, error } = await supabase
        .from('templates')
        .insert({ user_id: user.id, ...templateData })
        .select()
        .single();

      if (error) throw error;
      setTemplates([data, ...templates]);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateTemplate = async (id, updates) => {
    try {
      const { data, error } = await supabase
        .from('templates')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      setTemplates(templates.map((t) => (t.id === id ? data : t)));
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteTemplate = async (id) => {
    try {
      const { error } = await supabase.from('templates').delete().eq('id', id);

      if (error) throw error;
      setTemplates(templates.filter((t) => t.id !== id));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return {
    templates,
    loading,
    error,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    refetch: fetchTemplates,
  };
};

// ============================================
// SPACES HOOKS
// ============================================

export const useSpaces = (documentId) => {
  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!documentId || !isSupabaseAvailable()) {
      setLoading(false);
      return;
    }

    fetchSpaces();
  }, [documentId]);

  const fetchSpaces = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('spaces')
        .select('*')
        .eq('document_id', documentId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setSpaces(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createSpace = async (spaceData) => {
    if (!documentId || !isSupabaseAvailable()) return;

    try {
      const { data, error } = await supabase
        .from('spaces')
        .insert({ document_id: documentId, ...spaceData })
        .select()
        .single();

      if (error) throw error;
      setSpaces([...spaces, data]);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateSpace = async (id, updates) => {
    try {
      const { data, error } = await supabase
        .from('spaces')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      setSpaces(spaces.map((s) => (s.id === id ? data : s)));
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deleteSpace = async (id) => {
    try {
      const { error } = await supabase.from('spaces').delete().eq('id', id);

      if (error) throw error;
      setSpaces(spaces.filter((s) => s.id !== id));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return {
    spaces,
    loading,
    error,
    createSpace,
    updateSpace,
    deleteSpace,
    refetch: fetchSpaces,
  };
};

// ============================================
// STORAGE HOOKS
// ============================================

export const useStorage = () => {
  const { user } = useAuth();

  const uploadDocument = async (file, projectId, onProgress) => {
    if (!user || !isSupabaseAvailable()) {
      throw new Error('User not authenticated or Supabase not available');
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${user.id}/${projectId}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('documents')
      .upload(filePath, file, {
        onUploadProgress: onProgress,
      });

    if (error) throw error;
    return filePath;
  };

  const uploadDataFile = async (data, filePath, onProgress) => {
    if (!user || !isSupabaseAvailable()) {
      throw new Error('User not authenticated or Supabase not available');
    }

    const { data: result, error } = await supabase.storage
      .from('documents')
      .upload(filePath, data, {
        upsert: true,
        contentType: 'application/json',
        onUploadProgress: onProgress,
      });

    if (error) throw error;
    return filePath;
  };

  const downloadDocument = async (filePath) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase not available');
    }

    const { data, error } = await supabase.storage
      .from('documents')
      .download(filePath);

    if (error) throw error;
    return data;
  };

  const deleteDocumentFile = async (filePath) => {
    if (!isSupabaseAvailable()) {
      throw new Error('Supabase not available');
    }

    const { error } = await supabase.storage
      .from('documents')
      .remove([filePath]);

    if (error) throw error;
  };

  const getDocumentUrl = (filePath) => {
    if (!isSupabaseAvailable()) return null;

    const { data } = supabase.storage.from('documents').getPublicUrl(filePath);

    return data.publicUrl;
  };

  return {
    uploadDocument,
    uploadDataFile,
    downloadDocument,
    deleteDocumentFile,
    getDocumentUrl,
  };
};

// ============================================
// CONNECTED SERVICES HOOKS
// ============================================

/**
 * Hook for managing connected external services (Microsoft, Google, etc.)
 * Persists connection status to Supabase so services stay connected across sessions
 */
export const useConnectedServices = () => {
  const { user } = useAuth();
  const [services, setServices] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user || !isSupabaseAvailable()) {
      setLoading(false);
      return;
    }

    fetchServices();
  }, [user]);

  const fetchServices = async () => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('connected_services')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;

      // Convert array to object keyed by service_name for easier access
      const servicesMap = {};
      (data || []).forEach(service => {
        servicesMap[service.service_name] = service;
      });
      setServices(servicesMap);
    } catch (err) {
      console.error('Error fetching connected services:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const connectService = async (serviceName, accountData) => {
    if (!user || !isSupabaseAvailable()) return null;

    try {
      const serviceData = {
        user_id: user.id,
        service_name: serviceName,
        is_connected: true,
        account_id: accountData.accountId || null,
        account_email: accountData.email || null,
        account_name: accountData.name || null,
        metadata: accountData.metadata || {},
        connected_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('connected_services')
        .upsert(serviceData, { onConflict: 'user_id,service_name' })
        .select()
        .single();

      if (error) throw error;

      setServices(prev => ({
        ...prev,
        [serviceName]: data
      }));

      return data;
    } catch (err) {
      console.error('Error connecting service:', err);
      setError(err.message);
      throw err;
    }
  };

  const disconnectService = async (serviceName) => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      const { error } = await supabase
        .from('connected_services')
        .delete()
        .eq('user_id', user.id)
        .eq('service_name', serviceName);

      if (error) throw error;

      setServices(prev => {
        const updated = { ...prev };
        delete updated[serviceName];
        return updated;
      });
    } catch (err) {
      console.error('Error disconnecting service:', err);
      setError(err.message);
      throw err;
    }
  };

  const updateServiceLastUsed = async (serviceName) => {
    if (!user || !isSupabaseAvailable()) return;

    try {
      await supabase
        .from('connected_services')
        .update({ last_used_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('service_name', serviceName);
    } catch (err) {
      console.error('Error updating service last used:', err);
    }
  };

  const isServiceConnected = (serviceName) => {
    return services[serviceName]?.is_connected === true;
  };

  const getServiceInfo = (serviceName) => {
    return services[serviceName] || null;
  };

  return {
    services,
    loading,
    error,
    connectService,
    disconnectService,
    updateServiceLastUsed,
    isServiceConnected,
    getServiceInfo,
    refetch: fetchServices,
  };
};

// ============================================
// DOCUMENT TOOL PREFERENCES HOOKS
// ============================================

// Default preferences for each tool type
export const DEFAULT_TOOL_PREFERENCES = {
  pen: { strokeColor: '#ff0000', strokeWidth: 3, strokeOpacity: 100 },
  highlighter: { strokeColor: '#ffff00', strokeWidth: 20, strokeOpacity: 50 },
  eraser: { strokeWidth: 10 },
  rect: { strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, strokeOpacity: 100 },
  ellipse: { strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, strokeOpacity: 100 },
  line: { strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100 },
  arrow: { strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100 },
  text: { strokeColor: '#000000', strokeOpacity: 100 },
  note: { strokeColor: '#ffff00', fillColor: '#ffff00', strokeOpacity: 100, fillOpacity: 100 },
  underline: { strokeColor: '#ff0000', strokeOpacity: 100 },
  strikeout: { strokeColor: '#ff0000', strokeOpacity: 100 },
  squiggly: { strokeColor: '#ff0000', strokeOpacity: 100 },
  highlight: { strokeColor: '#ffff00', strokeOpacity: 50 },
};

// Tools that support stroke width
export const TOOLS_WITH_STROKE_WIDTH = ['pen', 'highlighter', 'eraser', 'rect', 'ellipse', 'line', 'arrow'];

// Tools that support fill
export const TOOLS_WITH_FILL = ['rect', 'ellipse', 'note'];

/**
 * Hook for managing per-document, per-tool preferences
 * Stores preferences in localStorage keyed by document ID
 * Optionally syncs to Supabase if user is authenticated and document exists in DB
 */
export const useDocumentToolPreferences = (documentId, supabaseDocId = null) => {
  const { user } = useAuth();
  const [toolPreferences, setToolPreferences] = useState(() => {
    // Initialize from localStorage if available
    if (documentId) {
      try {
        const saved = localStorage.getItem(`toolPrefs_${documentId}`);
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (e) {
        console.error('Error loading tool preferences from localStorage:', e);
      }
    }
    return { ...DEFAULT_TOOL_PREFERENCES };
  });
  const [loading, setLoading] = useState(false);

  // Load preferences when documentId changes
  useEffect(() => {
    if (!documentId) {
      setToolPreferences({ ...DEFAULT_TOOL_PREFERENCES });
      return;
    }

    // Load from localStorage first
    try {
      const saved = localStorage.getItem(`toolPrefs_${documentId}`);
      if (saved) {
        setToolPreferences(JSON.parse(saved));
      } else {
        setToolPreferences({ ...DEFAULT_TOOL_PREFERENCES });
      }
    } catch (e) {
      console.error('Error loading tool preferences:', e);
      setToolPreferences({ ...DEFAULT_TOOL_PREFERENCES });
    }

    // If we have a Supabase document ID and user, fetch from DB
    if (supabaseDocId && user && isSupabaseAvailable()) {
      fetchFromSupabase();
    }
  }, [documentId, supabaseDocId, user]);

  const fetchFromSupabase = async () => {
    if (!supabaseDocId || !user || !isSupabaseAvailable()) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('documents')
        .select('tool_preferences')
        .eq('id', supabaseDocId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching tool preferences from Supabase:', error);
        return;
      }

      if (data?.tool_preferences) {
        // Merge with defaults to ensure all tools have preferences
        const merged = { ...DEFAULT_TOOL_PREFERENCES, ...data.tool_preferences };
        setToolPreferences(merged);
        // Also save to localStorage for offline access
        if (documentId) {
          localStorage.setItem(`toolPrefs_${documentId}`, JSON.stringify(merged));
        }
      }
    } catch (err) {
      console.error('Error fetching tool preferences:', err);
    } finally {
      setLoading(false);
    }
  };

  // Update preferences for a specific tool
  const updateToolPreference = useCallback((toolId, updates) => {
    setToolPreferences(prev => {
      const currentToolPrefs = prev[toolId] || DEFAULT_TOOL_PREFERENCES[toolId] || {};
      const newPrefs = {
        ...prev,
        [toolId]: { ...currentToolPrefs, ...updates }
      };

      // Save to localStorage
      if (documentId) {
        try {
          localStorage.setItem(`toolPrefs_${documentId}`, JSON.stringify(newPrefs));
        } catch (e) {
          console.error('Error saving tool preferences to localStorage:', e);
        }
      }

      // Debounced save to Supabase
      if (supabaseDocId && user && isSupabaseAvailable()) {
        // Use a timeout to debounce rapid updates
        clearTimeout(updateToolPreference._saveTimeout);
        updateToolPreference._saveTimeout = setTimeout(async () => {
          try {
            await supabase
              .from('documents')
              .update({ tool_preferences: newPrefs })
              .eq('id', supabaseDocId);
          } catch (err) {
            console.error('Error saving tool preferences to Supabase:', err);
          }
        }, 500);
      }

      return newPrefs;
    });
  }, [documentId, supabaseDocId, user]);

  // Get preferences for a specific tool (with defaults)
  const getToolPreference = useCallback((toolId) => {
    return toolPreferences[toolId] || DEFAULT_TOOL_PREFERENCES[toolId] || {};
  }, [toolPreferences]);

  return {
    toolPreferences,
    updateToolPreference,
    getToolPreference,
    loading,
    refetch: fetchFromSupabase,
  };
};
