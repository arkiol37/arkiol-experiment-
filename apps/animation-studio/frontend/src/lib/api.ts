import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: inject access token ──────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('animstudio_access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const workspaceId = localStorage.getItem('animstudio_workspace_id');
  if (workspaceId) config.headers['X-Workspace-ID'] = workspaceId;

  return config;
});

// ── Response interceptor: auto-refresh on 401 ────────────────
let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry && !original.url?.includes('/auth/')) {
      original._retry = true;

      if (!refreshPromise) {
        const refreshToken = localStorage.getItem('animstudio_refresh_token');
        if (!refreshToken) {
          clearAuth();
          window.location.href = '/auth';
          return Promise.reject(error);
        }

        refreshPromise = api.post('/auth/refresh', { refreshToken })
          .then((res) => {
            const { accessToken, refreshToken: newRefresh } = res.data;
            localStorage.setItem('animstudio_access_token', accessToken);
            localStorage.setItem('animstudio_refresh_token', newRefresh);
            return accessToken;
          })
          .catch(() => {
            clearAuth();
            window.location.href = '/auth';
            return Promise.reject(error);
          })
          .finally(() => { refreshPromise = null; });
      }

      const newToken = await refreshPromise;
      if (original.headers) original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    }

    return Promise.reject(error);
  }
);

export function setAuth(tokens: { accessToken: string; refreshToken: string; workspaceId?: string }) {
  localStorage.setItem('animstudio_access_token', tokens.accessToken);
  localStorage.setItem('animstudio_refresh_token', tokens.refreshToken);
  if (tokens.workspaceId) localStorage.setItem('animstudio_workspace_id', tokens.workspaceId);
}

export function clearAuth() {
  localStorage.removeItem('animstudio_access_token');
  localStorage.removeItem('animstudio_refresh_token');
  localStorage.removeItem('animstudio_workspace_id');
}

export function isAuthenticated() {
  return !!localStorage.getItem('animstudio_access_token');
}

// ── Auth API ──────────────────────────────────────────────────
export const authApi = {
  register: (data: any) => api.post('/auth/register', data).then(r => r.data),
  login: (data: any) => api.post('/auth/login', data).then(r => r.data),
  googleAuth: (idToken: string) => api.post('/auth/google', { idToken }).then(r => r.data),
  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }).then(r => r.data),
  me: () => api.get('/auth/me').then(r => r.data),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }).then(r => r.data),
  resetPassword: (token: string, password: string) => api.post('/auth/reset-password', { token, password }).then(r => r.data),
};

// ── Projects API ──────────────────────────────────────────────
export const projectsApi = {
  list: () => api.get('/projects').then(r => r.data),
  get: (id: string) => api.get(`/projects/${id}`).then(r => r.data),
  create: (data: any) => api.post('/projects', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/projects/${id}`, data).then(r => r.data),
  createStoryboard: (projectId: string, data: any) => api.post(`/projects/${projectId}/storyboards`, data).then(r => r.data),
};

// ── Renders API ───────────────────────────────────────────────
export const rendersApi = {
  create: (data: any) => api.post('/renders', data).then(r => r.data),
  get: (id: string) => api.get(`/renders/${id}`).then(r => r.data),
  list: (params?: any) => api.get('/renders', { params }).then(r => r.data),
  retry: (id: string) => api.post(`/renders/${id}/retry`).then(r => r.data),
  cancel: (id: string) => api.post(`/renders/${id}/cancel`).then(r => r.data),
  download: (id: string, format?: string) =>
    api.get(`/renders/${id}/download`, { params: format ? { format } : {} }).then(r => r.data),
  regenerateScene: (sceneId: string, data?: any) => api.post(`/renders/scenes/${sceneId}/regenerate`, data).then(r => r.data),
};

// ── Assets API ────────────────────────────────────────────────
export const assetsApi = {
  list: (params?: any) => api.get('/assets', { params }).then(r => r.data),
  upload: (formData: FormData, onProgress?: (p: number) => void) =>
    api.post('/assets', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / (e.total || 1))),
    }).then(r => r.data),
  delete: (id: string) => api.delete(`/assets/${id}`).then(r => r.data),
};

// ── Brands API ────────────────────────────────────────────────
export const brandsApi = {
  list: () => api.get('/brands').then(r => r.data),
  create: (data: any) => api.post('/brands', data).then(r => r.data),
  update: (id: string, data: any) => api.put(`/brands/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/brands/${id}`).then(r => r.data),
};

// ── Billing API ───────────────────────────────────────────────
export const billingApi = {
  plans: () => api.get('/billing/plans').then(r => r.data),
  usage: () => api.get('/billing/usage').then(r => r.data),
  createCheckout: (data: any) => api.post('/billing/checkout', data).then(r => r.data),
  createPortal: () => api.post('/billing/portal').then(r => r.data),
  creditPack: (packSize: number) => api.post('/billing/credit-pack', { packSize }).then(r => r.data),
  invoices: () => api.get('/billing/invoices').then(r => r.data),
};

// ── Analytics API ─────────────────────────────────────────────
export const analyticsApi = {
  overview: (period?: string) => api.get('/analytics/overview', { params: { period } }).then(r => r.data),
};

// ── Providers API ─────────────────────────────────────────────
export const providersApi = {
  list:   () => api.get('/providers').then(r => r.data),
  add:    (data: any) => api.post('/providers', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/providers/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/providers/${id}`).then(r => r.data),
};

// ── User API ──────────────────────────────────────────────────
export const userApi = {
  updateProfile: (data: any) => api.patch('/users/me', data).then(r => r.data),
  getPreferences: () => api.get('/users/me/preferences').then(r => r.data),
  updatePreferences: (data: any) => api.patch('/users/me/preferences', data).then(r => r.data),
  deleteAccount: (password: string) => api.delete('/users/me', { data: { password } }).then(r => r.data),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/users/me/change-password', { currentPassword, newPassword }).then(r => r.data),
  getNotifications: () => api.get('/users/me/notifications').then(r => r.data),
  updateNotifications: (settings: Record<string, boolean>) =>
    api.patch('/users/me/notifications', settings).then(r => r.data),
  getSessions: () => api.get('/users/me/sessions').then(r => r.data),
  revokeSession: (id: string) => api.delete(`/users/me/sessions/${id}`).then(r => r.data),
  revokeAllSessions: () => api.delete('/users/me/sessions').then(r => r.data),
};

// ── Brand Assets API ──────────────────────────────────────────
export const brandAssetsApi = {
  /** Upload a brand asset (FormData with 'file' field) */
  upload: (formData: FormData, onProgress?: (p: number) => void) =>
    api.post('/brand-assets/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / (e.total || 1))),
      timeout: 120_000, // 2 min for large uploads
    }).then(r => r.data),

  /** List brand assets with optional filters */
  list: (params?: { type?: string; status?: string; search?: string; brandId?: string; readyOnly?: boolean; page?: number; limit?: number }) =>
    api.get('/brand-assets', { params }).then(r => r.data),

  /** Get a single brand asset with full processing result */
  get: (id: string) => api.get(`/brand-assets/${id}`).then(r => r.data),

  /** Override the AI-assigned usage role */
  updateRole: (id: string, role: string) =>
    api.patch(`/brand-assets/${id}/role`, { role }).then(r => r.data),

  /** Re-run the processing pipeline */
  reprocess: (id: string) => api.post(`/brand-assets/${id}/reprocess`).then(r => r.data),

  /** Soft-delete a brand asset */
  delete: (id: string) => api.delete(`/brand-assets/${id}`).then(r => r.data),

  /** Get merged brand palette for a set of asset IDs */
  getPalette: (assetIds: string[]) =>
    api.get(`/brand-assets/palette/${assetIds.join(',')}`).then(r => r.data),

  /** Resolve asset → scene slot assignments */
  resolveSlots: (assetIds: string[], sceneRoles: string[]) =>
    api.post('/brand-assets/slots', { assetIds, sceneRoles }).then(r => r.data),
};

export default api;


// ── Animation Engine API ────────────────────────────────────
export const engineApi = {
  generateAnimation: (data: any) => api.post('/v1/animation/generate', data).then(r => r.data),
  getPreview: (renderJobId: string) => api.get(`/v1/animation/preview/${renderJobId}`).then(r => r.data),
  getTemplates: (platform?: string, objective?: string) => api.get('/v1/animation/templates', { params: { platform, objective } }).then(r => r.data),
  applyTemplate: (id: string, overrides?: any) => api.post(`/v1/animation/templates/${id}/apply`, { overrides }).then(r => r.data),
  registerWebhook: (url: string, secret: string, events?: string[]) => api.post('/v1/animation/webhooks', { url, secret, events }).then(r => r.data),
};
