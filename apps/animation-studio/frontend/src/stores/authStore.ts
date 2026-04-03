import { create } from 'zustand';
import { authApi, setAuth, clearAuth } from '../lib/api';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatarUrl?: string;
  company?: string;
}

interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'creator' | 'pro' | 'studio';
  creditsBalance: number;
  subscriptionStatus?: string;
  memberRole: string;
}

interface AuthState {
  user: User | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
  preferences: any;
  isLoading: boolean;
  isAuthenticated: boolean;

  login: (email: string, password: string) => Promise<void>;
  googleLogin: (idToken: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => Promise<void>;
  loadMe: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  workspace: null,
  workspaces: [],
  preferences: null,
  isLoading: true,
  isAuthenticated: false,

  login: async (email, password) => {
    const data = await authApi.login({ email, password });
    setAuth({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      workspaceId: data.workspace?.id,
    });

    const normalized = normalizeUser(data.user);
    const normalizedWs = normalizeWorkspace(data.workspace);

    set({
      user: normalized,
      workspace: normalizedWs,
      isAuthenticated: true,
    });
  },

  googleLogin: async (idToken) => {
    const data = await authApi.googleAuth(idToken);
    setAuth({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      workspaceId: data.workspace?.id,
    });
    set({
      user: normalizeUser(data.user),
      workspace: normalizeWorkspace(data.workspace),
      isAuthenticated: true,
    });
  },

  register: async (formData) => {
    await authApi.register(formData);
    // Don't auto-login after register - require email verification in production
    // For demo: auto-login
    await get().login(formData.email, formData.password);
  },

  logout: async () => {
    const refreshToken = localStorage.getItem('animstudio_refresh_token');
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } finally {
      clearAuth();
      set({ user: null, workspace: null, isAuthenticated: false });
    }
  },

  loadMe: async () => {
    const token = localStorage.getItem('animstudio_access_token');
    if (!token) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }

    try {
      const data = await authApi.me();
      set({
        user: normalizeUser(data.user),
        workspaces: data.workspaces?.map(normalizeWorkspace) || [],
        workspace: data.workspaces?.[0] ? normalizeWorkspace(data.workspaces[0]) : null,
        preferences: data.preferences,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      clearAuth();
      set({ isLoading: false, isAuthenticated: false });
    }
  },

  switchWorkspace: (workspaceId: string) => {
    const { workspaces } = get();
    const ws = workspaces.find(w => w.id === workspaceId);
    if (ws) {
      localStorage.setItem('animstudio_workspace_id', workspaceId);
      set({ workspace: ws });
    }
  },

  setUser: (user) => set({ user }),
}));

function normalizeUser(u: any): User {
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    role: u.role,
    avatarUrl: u.avatar_url,
    company: u.company,
  };
}

function normalizeWorkspace(w: any): Workspace {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    plan: w.plan,
    creditsBalance: w.credits_balance,
    subscriptionStatus: w.subscription_status,
    memberRole: w.member_role || w.role,
  };
}
