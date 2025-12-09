import { useState, useEffect } from 'react';
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
