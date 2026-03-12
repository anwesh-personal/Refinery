import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export async function apiCall<T>(
  path: string,
  options?: { method?: string; body?: any; serverId?: string }
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  };

  if (options?.serverId) {
    headers['X-Server-Id'] = options.serverId;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: options?.method || 'GET',
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = res.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    throw new Error((data && typeof data === 'object' && data.error) ? data.error : `HTTP ${res.status}`);
  }

  return data as T;
}
