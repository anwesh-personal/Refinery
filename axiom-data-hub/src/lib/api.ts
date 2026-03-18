import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export async function apiCall<T>(
  path: string,
  options?: { method?: string; body?: any; serverId?: string; responseType?: 'json' | 'text' | 'blob' }
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }

  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${session.access_token}`,
  };

  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  if (options?.serverId) {
    headers['X-Server-Id'] = options.serverId;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: options?.method || 'GET',
    headers,
    body: isFormData ? options.body : (options?.body ? JSON.stringify(options.body) : undefined),
  });

  if (!res.ok) {
    let errText = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error) errText = parsed.error;
    } catch { /* not json */ }
    throw new Error(errText || `HTTP ${res.status}`);
  }

  if (options?.responseType === 'blob') {
    return (await res.blob()) as unknown as T;
  }
  
  if (options?.responseType === 'text') {
    return (await res.text()) as unknown as T;
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await res.json();
  }
  
  return (await res.text()) as unknown as T;
}
