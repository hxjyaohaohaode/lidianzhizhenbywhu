/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useState, useRef, useCallback, useMemo, createContext, useContext } from "react";
import {
  bootstrapUserIdentity,
  fetchUserProfile,
  fetchInvestorSessions,
  updateUserPreferences,
  fetchLatestIndustryData,
} from "../api.js";
import {
  DEFAULT_ENTERPRISE_ONBOARDING,
  applyIndustryStandardOverride,
  loadIndustryStandardFromPlatformStore,
  getIndustryStandardVersion,
} from "../chart-data.js";
import { useUnitPreferences } from "../UnitSelector.js";
import { DataFormatter, type UnitPreferences, loadUnitPreferences, saveUnitPreferences } from "../data-formatter.js";
import type {
  EditableBusinessInfo,
  SessionHistorySummary,
  UserPreferencesUpdateRequest,
  UserProfileResponse,
} from "../../shared/business.js";
import {
  type AppState,
  type AppTab,
  type RoleKey,
  USER_ID_STORAGE_KEY,
  USER_ROLE_STORAGE_KEY,
  USER_THEME_MODE_STORAGE_KEY,
  USER_THEME_COLOR_STORAGE_KEY,
  USER_REMEMBER_ROLE_STORAGE_KEY,
  DEFAULT_INVESTOR_ONBOARDING,
  preferenceToRoleKey,
  roleKeyToPreference,
  themeIndexToColorKey,
  themeColorKeyToIndex,
  mergeLocalUserProfile,
  splitInputTags,
  dedupeStrings,
  DEFAULT_ENTERPRISE_NAME,
  isEnterpriseOnboardingComplete,
  isInvestorOnboardingComplete,
} from "../utils/helpers.js";
import type { EnterpriseOnboardingDraft } from "../../shared/types.js";

interface AppContextValue {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  role: RoleKey | null;
  setRole: React.Dispatch<React.SetStateAction<RoleKey | null>>;
  tab: AppTab;
  setTab: React.Dispatch<React.SetStateAction<AppTab>>;
  isDark: boolean;
  setIsDark: (isDark: boolean) => void;
  themeIndex: number;
  setThemeIndex: (themeIndex: number) => void;
  chartThemeKey: number;
  currentUserId: string | null;
  userProfile: UserProfileResponse | null;
  setUserProfile: React.Dispatch<React.SetStateAction<UserProfileResponse | null>>;
  userReady: boolean;
  loadingFinished: boolean;
  setLoadingFinished: React.Dispatch<React.SetStateAction<boolean>>;
  rememberRole: boolean;
  setRememberRole: React.Dispatch<React.SetStateAction<boolean>>;
  handleRememberRoleChange: (remember: boolean) => void;
  enterpriseOnboarding: EnterpriseOnboardingDraft;
  setEnterpriseOnboarding: React.Dispatch<React.SetStateAction<EnterpriseOnboardingDraft>>;
  investorOnboarding: typeof DEFAULT_INVESTOR_ONBOARDING;
  setInvestorOnboarding: React.Dispatch<React.SetStateAction<typeof DEFAULT_INVESTOR_ONBOARDING>>;
  isCommandPaletteOpen: boolean;
  setIsCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  refreshInterval: number;
  isRefreshing: boolean;
  lastDataRefreshAt: string;
  industryDataVersion: number;
  unitPrefs: UnitPreferences;
  dataFormatter: DataFormatter;
  onUnitPrefsChange: (prefs: UnitPreferences) => void;
  onRefreshData: () => void;
  onRefreshIntervalChange: (ms: number) => void;
  prefetchedSessionHistoryRef: React.MutableRefObject<SessionHistorySummary[] | null>;
  syncUserProfile: (nextProfile: UserProfileResponse) => void;
  applyLocalUserProfilePatch: (payload: Partial<UserPreferencesUpdateRequest>) => void;
  refreshUserProfile: (userId?: string) => Promise<UserProfileResponse | null>;
  persistUserPreferences: (payload: Omit<UserPreferencesUpdateRequest, "userId">) => Promise<UserProfileResponse | null>;
  handleThemeModeChange: (nextIsDark: boolean) => void;
  handleThemeIndexChange: (nextThemeIndex: number) => void;
  handleRoleSelect: (r: RoleKey) => void;
  handleGoApp: (r: RoleKey) => void;
  saveEnterpriseBaseInfo: (baseInfo: EditableBusinessInfo) => Promise<void>;
  saveInvestorBaseInfo: (baseInfo: EditableBusinessInfo) => Promise<void>;
  openMem: () => void;
  closeMem: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const ENTERPRISE_ONBOARDING_KEY = "app_enterprise_onboarding";
const INVESTOR_ONBOARDING_KEY = "app_investor_onboarding";

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [appState, setAppState] = useState<AppState>('loading');
  const [role, setRole] = useState<RoleKey | null>(null);
  const [tab, setTab] = useState<AppTab>('home');
  const [memReturnState, setMemReturnState] = useState<AppState>('app-e');
  const [isDark, setIsDarkState] = useState(false);
  const [themeIndex, setThemeIndexState] = useState(0);
  const [chartThemeKey, setChartThemeKey] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfileResponse | null>(null);
  const [userReady, setUserReady] = useState(false);
  const [loadingFinished, setLoadingFinished] = useState(false);
  const [hasPersistedRole, setHasPersistedRole] = useState(false);
  const [rememberRole, setRememberRole] = useState(false);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [enterpriseOnboarding, setEnterpriseOnboarding] = useState<EnterpriseOnboardingDraft>(DEFAULT_ENTERPRISE_ONBOARDING);
  const [investorOnboarding, setInvestorOnboarding] = useState(DEFAULT_INVESTOR_ONBOARDING);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<number>(60000);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastDataRefreshAt, setLastDataRefreshAt] = useState<string>("");
  const [industryDataVersion, setIndustryDataVersion] = useState(getIndustryStandardVersion());
  const prefetchedSessionHistoryRef = useRef<SessionHistorySummary[] | null>(null);
  const { preferences: unitPrefs, updatePreferences: updateUnitPrefs } = useUnitPreferences();
  const dataFormatter = useMemo(() => new DataFormatter(unitPrefs), [unitPrefs]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const syncUserProfile = useCallback((nextProfile: UserProfileResponse) => {
    const nextUserId = nextProfile.profile.userId;
    const nextRole = preferenceToRoleKey(nextProfile.profile.preferences.preferredRole);
    const nextThemeMode = nextProfile.profile.preferences.themeMode;
    const nextThemeColor = nextProfile.profile.preferences.themeColor;
    const nextAmountUnit = nextProfile.profile.preferences.amountUnit;
    const nextPercentageUnit = nextProfile.profile.preferences.percentageUnit;
    const nextVolumeUnit = nextProfile.profile.preferences.volumeUnit;

    setCurrentUserId(nextUserId);
    setUserProfile(nextProfile);
    localStorage.setItem(USER_ID_STORAGE_KEY, nextUserId);

    if (nextRole) {
      localStorage.setItem(USER_ROLE_STORAGE_KEY, roleKeyToPreference(nextRole));
      setRole(nextRole);
    }

    if (nextThemeMode) {
      localStorage.setItem(USER_THEME_MODE_STORAGE_KEY, nextThemeMode);
      setIsDarkState(nextThemeMode !== "light");
    }

    if (nextThemeColor) {
      localStorage.setItem(USER_THEME_COLOR_STORAGE_KEY, nextThemeColor);
      setThemeIndexState(themeColorKeyToIndex(nextThemeColor));
    }

    if (nextAmountUnit || nextPercentageUnit || nextVolumeUnit) {
      const currentUnitPrefs = loadUnitPreferences();
      const mergedUnitPrefs = {
        amountUnit: nextAmountUnit ?? currentUnitPrefs.amountUnit,
        percentageUnit: nextPercentageUnit ?? currentUnitPrefs.percentageUnit,
        volumeUnit: nextVolumeUnit ?? currentUnitPrefs.volumeUnit,
      };
      saveUnitPreferences(mergedUnitPrefs);
      updateUnitPrefs(mergedUnitPrefs);
    }
  }, [updateUnitPrefs]);

  const applyLocalUserProfilePatch = useCallback((payload: Partial<UserPreferencesUpdateRequest>) => {
    setUserProfile((previous) => mergeLocalUserProfile(previous, payload));
    const nextRole = preferenceToRoleKey(payload.preferredRole ?? payload.role);
    if (nextRole) {
      setRole(nextRole);
      localStorage.setItem(USER_ROLE_STORAGE_KEY, roleKeyToPreference(nextRole));
    }
  }, []);

  const refreshUserProfile = useCallback(async (userId?: string) => {
    const resolvedUserId = userId ?? currentUserId;
    if (!resolvedUserId) return null;
    const profile = await fetchUserProfile(resolvedUserId);
    syncUserProfile(profile);
    return profile;
  }, [currentUserId, syncUserProfile]);

  const persistUserPreferences = useCallback(async (payload: Omit<UserPreferencesUpdateRequest, "userId">) => {
    const resolvedUserId = currentUserId;
    if (!resolvedUserId) return null;
    const cleanedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== "")
    );
    try {
      const profile = await updateUserPreferences(resolvedUserId, cleanedPayload as Omit<UserPreferencesUpdateRequest, "userId">);
      syncUserProfile(profile);
      return profile;
    } catch (error) {
      console.warn("Failed to persist preferences:", error);
      return null;
    }
  }, [currentUserId, syncUserProfile]);

  const handleThemeModeChange = useCallback((nextIsDark: boolean) => {
    setIsDarkState(nextIsDark);
    setChartThemeKey(prev => prev + 1);
    localStorage.setItem(USER_THEME_MODE_STORAGE_KEY, nextIsDark ? "dark" : "light");
    applyLocalUserProfilePatch({
      themeMode: nextIsDark ? "dark" : "light",
      themeColor: themeIndexToColorKey(themeIndex),
      preferredRole: role ? roleKeyToPreference(role) : undefined,
    });
    void persistUserPreferences({
      themeMode: nextIsDark ? "dark" : "light",
      themeColor: themeIndexToColorKey(themeIndex),
      preferredRole: role ? roleKeyToPreference(role) : undefined,
    });
  }, [applyLocalUserProfilePatch, persistUserPreferences, role, themeIndex]);

  const handleThemeIndexChange = useCallback((nextThemeIndex: number) => {
    const nextThemeColor = themeIndexToColorKey(nextThemeIndex);
    setThemeIndexState(nextThemeIndex);
    setChartThemeKey(prev => prev + 1);
    localStorage.setItem(USER_THEME_COLOR_STORAGE_KEY, nextThemeColor);
    applyLocalUserProfilePatch({
      themeMode: isDark ? "dark" : "light",
      themeColor: nextThemeColor,
      preferredRole: role ? roleKeyToPreference(role) : undefined,
    });
    void persistUserPreferences({
      themeMode: isDark ? "dark" : "light",
      themeColor: nextThemeColor,
      preferredRole: role ? roleKeyToPreference(role) : undefined,
    });
  }, [applyLocalUserProfilePatch, isDark, persistUserPreferences, role]);

  const handleUnitPrefsChange = useCallback((prefs: UnitPreferences) => {
    updateUnitPrefs(prefs);
    void persistUserPreferences({
      themeMode: isDark ? "dark" : "light",
      themeColor: themeIndexToColorKey(themeIndex),
      preferredRole: role ? roleKeyToPreference(role) : undefined,
      amountUnit: prefs.amountUnit,
      percentageUnit: prefs.percentageUnit,
      volumeUnit: prefs.volumeUnit,
    });
  }, [updateUnitPrefs, persistUserPreferences, isDark, themeIndex, role]);

  const handleRefreshData = useCallback(async () => {
    if (!currentUserId || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        refreshUserProfile(currentUserId),
        loadIndustryStandardFromPlatformStore(),
      ]);
      setIndustryDataVersion(getIndustryStandardVersion());
      setLastDataRefreshAt(new Date().toLocaleTimeString());
    } catch {
      // noop
    } finally {
      setIsRefreshing(false);
    }
  }, [currentUserId, isRefreshing, refreshUserProfile]);

  useEffect(() => {
    if (!currentUserId || refreshInterval <= 0) return;
    const timer = window.setInterval(() => { void handleRefreshData(); }, refreshInterval);
    return () => window.clearInterval(timer);
  }, [currentUserId, refreshInterval, handleRefreshData]);

  const handleRefreshIntervalChange = useCallback((ms: number) => {
    setRefreshInterval(ms);
    localStorage.setItem("refreshInterval", String(ms));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("refreshInterval");
    if (stored) {
      const parsed = Number(stored);
      if ([30000, 60000, 120000, 0].includes(parsed)) setRefreshInterval(parsed);
    }
  }, []);

  useEffect(() => {
    if (enterpriseOnboarding) {
      localStorage.setItem(ENTERPRISE_ONBOARDING_KEY, JSON.stringify(enterpriseOnboarding));
    }
  }, [enterpriseOnboarding]);

  useEffect(() => {
    if (investorOnboarding) {
      localStorage.setItem(INVESTOR_ONBOARDING_KEY, JSON.stringify(investorOnboarding));
    }
  }, [investorOnboarding]);

  useEffect(() => {
    fetchLatestIndustryData()
      .then((res) => {
        if (res.success && res.data) {
          const d = res.data as Record<string, unknown>;
          const lp = d.lithiumPrice as Record<string, unknown> | undefined;
          const ii = d.industryIndex as Record<string, unknown> | undefined;
          const override: Record<string, number> = {};
          if (lp && typeof lp.price === "number" && lp.price > 0) override.lithiumPrice = lp.price / 10000;
          if (ii && typeof ii.volatility === "number" && ii.volatility > 0) override.industryWarmth = Math.round((1 - ii.volatility) * 100);
          if (Object.keys(override).length > 0) applyIndustryStandardOverride(override);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const themes = [
      { blue: '#3b82f6', purple: '#8b5cf6', cyan: '#06b6d4' },
      { blue: '#10b981', purple: '#06b6d4', cyan: '#3b82f6' },
      { blue: '#f59e0b', purple: '#ef4444', cyan: '#ec4899' },
      { blue: '#ec4899', purple: '#8b5cf6', cyan: '#f43f5e' }
    ];
    const t = themes[themeIndex] ?? themes[0];
    if (t) {
      root.style.setProperty('--blue', t.blue);
      root.style.setProperty('--purple', t.purple);
      root.style.setProperty('--cyan', t.cyan);
    }

    if (isDark) {
      root.classList.add('theme-dark');
      root.classList.remove('theme-light');
      root.style.setProperty('--bg', 'radial-gradient(circle at 15% 0%, color-mix(in srgb, #3B82F6 15%, transparent) 0%, transparent 50%), radial-gradient(circle at 85% 100%, color-mix(in srgb, #8B5CF6 15%, transparent) 0%, transparent 50%), radial-gradient(circle at 100% 0%, color-mix(in srgb, #06B6D4 15%, transparent) 0%, transparent 50%), #0b0f1a');
      root.style.setProperty('--bg2', '#111827');
      root.style.setProperty('--gl', 'rgba(255,255,255,.05)');
      root.style.setProperty('--bd', 'rgba(255,255,255,.1)');
      root.style.setProperty('--bd-hover', 'rgba(255,255,255,.2)');
      root.style.setProperty('--t1', '#f8fafc');
      root.style.setProperty('--t2', '#cbd5e1');
      root.style.setProperty('--t3', '#94a3b8');
      root.style.setProperty('--t4', '#64748b');
      root.style.setProperty('--overlay', 'rgba(0,0,0,.6)');
      root.style.setProperty('--glass-bg', 'rgba(15,23,42,.75)');
      root.style.setProperty('--glass', 'rgba(15,23,42,.55)');
      root.style.setProperty('--glass-soft', 'rgba(15,23,42,.4)');
      root.style.setProperty('--chat-bg', 'rgba(0,0,0,.2)');
      root.style.setProperty('--chat-input-bg', 'rgba(15,23,42,.8)');
      root.style.setProperty('--sidebar-bg', 'rgba(15,23,42,.4)');
      root.style.setProperty('--panel-bg', 'rgba(15,23,42,.4)');
      root.style.setProperty('--nav-bg', 'rgba(15,23,42,.5)');
      root.style.setProperty('--tree-node-bg', 'rgba(255,255,255,.05)');
      root.style.setProperty('--tree-node-border', 'rgba(255,255,255,.15)');
      root.style.setProperty('--shadow-color', 'rgba(0,0,0,0.6)');
      root.style.setProperty('--glass-highlight', 'inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.3)');
      root.style.setProperty('--glass-blur', 'blur(16px)');
      root.style.setProperty('--glass-surface', 'linear-gradient(180deg,rgba(28,37,60,.84),rgba(10,16,30,.72))');
      root.style.setProperty('--glass-surface-strong', 'linear-gradient(180deg,rgba(24,33,55,.9),rgba(7,10,20,.82))');
      root.style.setProperty('--glass-border-soft', 'rgba(255,255,255,.1)');
      root.style.setProperty('--glass-border-strong', 'rgba(255,255,255,.18)');
      root.style.setProperty('--global-noise-opacity', '.08');
      root.style.setProperty('--global-noise-blend', 'soft-light');
      root.style.setProperty('--nav-shell', 'rgba(0,0,0,.2)');
      root.style.setProperty('--toolbar-bg', 'rgba(0,0,0,.1)');
      root.style.setProperty('--tooltip-bg', 'rgba(15,23,42,.95)');
      root.style.setProperty('--chat-footer-bg', 'rgba(15,23,42,.6)');
      root.style.setProperty('--mode-strip-bg', 'rgba(15,23,42,.4)');
      root.style.setProperty('--workspace-header-bg', 'linear-gradient(180deg,rgba(15,23,42,.48),rgba(15,23,42,.18))');
      root.style.setProperty('--modal-overlay-strong', 'rgba(0,0,0,.48)');
      root.style.setProperty('--modal-overlay-soft', 'rgba(0,0,0,.4)');
      root.style.setProperty('--role-title-start', '#ffffff');
      root.style.setProperty('--debate-bg', 'linear-gradient(135deg,rgba(15,23,42,.88),rgba(30,41,59,.82))');
      root.style.setProperty('--live-progress-fg', '#dbeafe');
      root.style.setProperty('--live-progress-strong', '#ffffff');
      root.style.setProperty('--badge-info', '#bfdbfe');
      root.style.setProperty('--history-check-bg', 'rgba(0,0,0,.18)');
      root.style.setProperty('--line', 'rgba(255,255,255,.08)');
      root.style.setProperty('--rs', '6px');
      root.style.setProperty('--border', 'rgba(255,255,255,.15)');
    } else {
      root.classList.add('theme-light');
      root.classList.remove('theme-dark');
      root.style.setProperty('--bg', 'linear-gradient(135deg, #F8FAFF 0%, #EEF2FF 40%, #F0F9FF 100%)');
      root.style.setProperty('--bg2', '#FFFFFF');
      root.style.setProperty('--gl', 'rgba(255,255,255,.6)');
      root.style.setProperty('--bd', 'rgba(79,107,246,.12)');
      root.style.setProperty('--line', 'rgba(79,107,246,.08)');
      root.style.setProperty('--bd-hover', 'rgba(79,107,246,.2)');
      root.style.setProperty('--t1', '#1E293B');
      root.style.setProperty('--t2', '#475569');
      root.style.setProperty('--t3', '#94A3B8');
      root.style.setProperty('--t4', '#94A3B8');
      root.style.setProperty('--overlay', 'rgba(148,163,184,.3)');
      root.style.setProperty('--glass-bg', 'rgba(255,255,255,.7)');
      root.style.setProperty('--glass', 'rgba(255,255,255,.55)');
      root.style.setProperty('--glass-soft', 'rgba(255,255,255,.4)');
      root.style.setProperty('--chat-bg', 'rgba(255,255,255,.5)');
      root.style.setProperty('--chat-input-bg', 'rgba(255,255,255,.75)');
      root.style.setProperty('--sidebar-bg', 'rgba(255,255,255,.5)');
      root.style.setProperty('--panel-bg', 'rgba(255,255,255,.55)');
      root.style.setProperty('--nav-bg', 'rgba(255,255,255,.6)');
      root.style.setProperty('--tree-node-bg', 'rgba(255,255,255,.6)');
      root.style.setProperty('--tree-node-border', 'rgba(79,107,246,.12)');
      root.style.setProperty('--shadow-color', 'rgba(79,107,246,.08)');
      root.style.setProperty('--glass-highlight', 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(79,107,246,0.04)');
      root.style.setProperty('--glass-blur', 'blur(20px) saturate(180%)');
      root.style.setProperty('--glass-surface', 'linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.38))');
      root.style.setProperty('--glass-surface-strong', 'linear-gradient(180deg,rgba(255,255,255,.82),rgba(255,255,255,.48))');
      root.style.setProperty('--glass-border-soft', 'rgba(79,107,246,.1)');
      root.style.setProperty('--glass-border-strong', 'rgba(79,107,246,.18)');
      root.style.setProperty('--global-noise-opacity', '.03');
      root.style.setProperty('--global-noise-blend', 'overlay');
      root.style.setProperty('--nav-shell', 'rgba(255,255,255,.5)');
      root.style.setProperty('--toolbar-bg', 'rgba(255,255,255,.4)');
      root.style.setProperty('--tooltip-bg', 'rgba(255,255,255,.95)');
      root.style.setProperty('--chat-footer-bg', 'rgba(255,255,255,.6)');
      root.style.setProperty('--mode-strip-bg', 'rgba(255,255,255,.45)');
      root.style.setProperty('--workspace-header-bg', 'linear-gradient(180deg,rgba(255,255,255,.7),rgba(255,255,255,.2))');
      root.style.setProperty('--modal-overlay-strong', 'rgba(148,163,184,.3)');
      root.style.setProperty('--modal-overlay-soft', 'rgba(148,163,184,.15)');
      root.style.setProperty('--role-title-start', '#1E293B');
      root.style.setProperty('--debate-bg', 'linear-gradient(135deg,rgba(255,255,255,.8),rgba(238,242,255,.6))');
      root.style.setProperty('--live-progress-fg', '#4F6BF6');
      root.style.setProperty('--live-progress-strong', '#1E293B');
      root.style.setProperty('--badge-info', 'rgba(79,107,246,.12)');
      root.style.setProperty('--history-check-bg', 'rgba(255,255,255,.6)');
      root.style.setProperty('--rs', '10px');
      root.style.setProperty('--border', 'rgba(79,107,246,.1)');
      root.style.setProperty('--r', '16px');
      root.style.setProperty('--rl', '16px');
      root.style.setProperty('--viz-grid-stroke', 'rgba(79,107,246,0.06)');
      root.style.setProperty('--viz-axis-stroke', 'rgba(71,85,105,0.2)');
      root.style.setProperty('--viz-axis-text', 'rgba(71,85,105,0.7)');
      root.style.setProperty('--viz-legend-text', 'rgba(71,85,105,0.65)');
      root.style.setProperty('--viz-tooltip-bg', 'rgba(255,255,255,0.95)');
      root.style.setProperty('--viz-tooltip-border', 'rgba(79,107,246,0.1)');
      root.style.setProperty('--viz-tooltip-title', '#1E293B');
      root.style.setProperty('--viz-tooltip-text', 'rgba(71,85,105,0.8)');
      root.style.setProperty('--viz-surface-bg', 'rgba(255,255,255,0.7)');
      root.style.setProperty('--viz-surface-border', 'rgba(79,107,246,0.08)');
      root.style.setProperty('--viz-surface-shadow', '0 2px 8px rgba(79,107,246,0.06), 0 8px 24px rgba(79,107,246,0.08)');
    }
  }, [themeIndex, isDark]);

  useEffect(() => {
    const storedThemeMode = localStorage.getItem(USER_THEME_MODE_STORAGE_KEY);
    const storedThemeColor = localStorage.getItem(USER_THEME_COLOR_STORAGE_KEY);
    if (storedThemeMode === "light") setIsDarkState(false);
    if (storedThemeColor) setThemeIndexState(themeColorKeyToIndex(storedThemeColor));

    void (async () => {
      const storedUserId = localStorage.getItem(USER_ID_STORAGE_KEY) ?? undefined;
      const storedRole = localStorage.getItem(USER_ROLE_STORAGE_KEY);
      setHasPersistedRole(storedRole === "enterprise" || storedRole === "investor");
      const storedRememberRole = localStorage.getItem(USER_REMEMBER_ROLE_STORAGE_KEY);
      setRememberRole(storedRememberRole === null || storedRememberRole === "true");

      if (storedRole === "enterprise") {
        try {
          const savedOnboarding = localStorage.getItem(ENTERPRISE_ONBOARDING_KEY);
          if (savedOnboarding) {
            const parsed = JSON.parse(savedOnboarding);
            setEnterpriseOnboarding(parsed);
          }
        } catch { /* ignore parse errors */ }
      } else if (storedRole === "investor") {
        try {
          const savedOnboarding = localStorage.getItem(INVESTOR_ONBOARDING_KEY);
          if (savedOnboarding) {
            const parsed = JSON.parse(savedOnboarding);
            setInvestorOnboarding(parsed);
          }
        } catch { /* ignore parse errors */ }
      }

      setOnboardingLoaded(true);

      try {
        const profile = storedUserId
          ? await fetchUserProfile(storedUserId)
          : await bootstrapUserIdentity({
              preferredRole: storedRole === "enterprise" || storedRole === "investor" ? storedRole : undefined,
              themeMode: storedThemeMode === "light" || storedThemeMode === "dark" ? storedThemeMode : "dark",
              themeColor: storedThemeColor ?? themeIndexToColorKey(themeIndex),
              investedEnterprises: [],
              interests: [],
              attentionTags: [],
              goals: [],
              constraints: [],
              decisionStyleHints: [],
              enterpriseBaseInfo: {},
              investorBaseInfo: {},
            });
        syncUserProfile(profile);

        const nextRole = preferenceToRoleKey(profile.profile.preferences.preferredRole);
        if (nextRole === "i" && profile.profile.userId) {
          try {
            const sessionResponse = await fetchInvestorSessions(profile.profile.userId);
            prefetchedSessionHistoryRef.current = sessionResponse.items;
          } catch {
            // noop
          }
        }
      } catch {
        const profile = await bootstrapUserIdentity({
          userId: storedUserId,
          preferredRole: storedRole === "enterprise" || storedRole === "investor" ? storedRole : undefined,
          themeMode: storedThemeMode === "light" || storedThemeMode === "dark" ? storedThemeMode : "dark",
          themeColor: storedThemeColor ?? themeIndexToColorKey(themeIndex),
          investedEnterprises: [],
          interests: [],
          attentionTags: [],
          goals: [],
          constraints: [],
          decisionStyleHints: [],
          enterpriseBaseInfo: {},
          investorBaseInfo: {},
        });
        syncUserProfile(profile);
      } finally {
        setUserReady(true);
      }
      loadIndustryStandardFromPlatformStore().catch(() => {});
    })();
  }, [syncUserProfile, themeIndex]);

  useEffect(() => {
    if (appState !== 'loading' || !loadingFinished || !userReady || !onboardingLoaded) return;
    setAppState('role');
  }, [appState, loadingFinished, onboardingLoaded, userReady]);

  const handleRoleSelect = useCallback((r: RoleKey) => {
    setRole(r);
    localStorage.setItem(USER_ROLE_STORAGE_KEY, roleKeyToPreference(r));
    if (rememberRole) {
      localStorage.setItem(USER_REMEMBER_ROLE_STORAGE_KEY, "true");
    } else {
      localStorage.setItem(USER_REMEMBER_ROLE_STORAGE_KEY, "false");
    }
    applyLocalUserProfilePatch({ preferredRole: roleKeyToPreference(r), role: roleKeyToPreference(r) });
    void persistUserPreferences({ preferredRole: roleKeyToPreference(r), role: roleKeyToPreference(r), themeMode: isDark ? "dark" : "light", themeColor: themeIndexToColorKey(themeIndex) });
    setAppState(r === 'e' ? 'collect-e' : 'collect-i');
  }, [applyLocalUserProfilePatch, isDark, persistUserPreferences, themeIndex, rememberRole]);

  const handleGoApp = useCallback((r: RoleKey) => {
    const nextPreference = roleKeyToPreference(r);
    const nextPayload: Omit<UserPreferencesUpdateRequest, "userId"> = {
      preferredRole: nextPreference,
      role: nextPreference,
      themeMode: isDark ? "dark" : "light",
      themeColor: themeIndexToColorKey(themeIndex),
      enterpriseName: r === "e" ? enterpriseOnboarding.enterpriseName.trim() || DEFAULT_ENTERPRISE_NAME : undefined,
    };
    if (r === "i") {
      nextPayload.displayName = investorOnboarding.investorName.trim() || undefined;
      nextPayload.investedEnterprises = splitInputTags(investorOnboarding.investedEnterprises);
      nextPayload.riskAppetite = investorOnboarding.riskAppetite || undefined;
      nextPayload.investmentHorizon = investorOnboarding.investmentHorizon || undefined;
      nextPayload.interests = dedupeStrings([investorOnboarding.industryInterest, investorOnboarding.focusTopic]).slice(0, 8);
      nextPayload.attentionTags = splitInputTags(investorOnboarding.notes).slice(0, 8);
    }
    applyLocalUserProfilePatch(nextPayload);
    void persistUserPreferences(nextPayload);
    setRole(r);
    if (rememberRole) {
      localStorage.setItem(USER_REMEMBER_ROLE_STORAGE_KEY, "true");
    } else {
      localStorage.setItem(USER_REMEMBER_ROLE_STORAGE_KEY, "false");
    }
    setAppState(r === 'e' ? 'app-e' : 'app-i');
    setTab('home');
  }, [applyLocalUserProfilePatch, enterpriseOnboarding, investorOnboarding, isDark, persistUserPreferences, themeIndex, rememberRole]);

  const handleRememberRoleChange = useCallback((remember: boolean) => {
    setRememberRole(remember);
    localStorage.setItem(USER_REMEMBER_ROLE_STORAGE_KEY, remember ? "true" : "false");
  }, []);

  const saveEnterpriseBaseInfo = useCallback(async (baseInfo: EditableBusinessInfo) => {
    const previousProfile = userProfile;
    applyLocalUserProfilePatch({ enterpriseBaseInfo: baseInfo });
    try {
      await persistUserPreferences({ enterpriseBaseInfo: baseInfo });
    } catch (error) {
      setUserProfile(previousProfile);
      throw error instanceof Error ? error : new Error("保存失败，请稍后重试");
    }
  }, [applyLocalUserProfilePatch, persistUserPreferences, userProfile]);

  const saveInvestorBaseInfo = useCallback(async (baseInfo: EditableBusinessInfo) => {
    const previousProfile = userProfile;
    applyLocalUserProfilePatch({ investorBaseInfo: baseInfo });
    try {
      await persistUserPreferences({ investorBaseInfo: baseInfo });
    } catch (error) {
      setUserProfile(previousProfile);
      throw error instanceof Error ? error : new Error("保存失败，请稍后重试");
    }
  }, [applyLocalUserProfilePatch, persistUserPreferences, userProfile]);

  const openMem = useCallback(() => {
    setMemReturnState(appState);
    void refreshUserProfile();
    setAppState('mem');
  }, [appState, refreshUserProfile]);

  const closeMem = useCallback(() => {
    setAppState(memReturnState);
  }, [memReturnState]);

  const value = useMemo<AppContextValue>(() => ({
    appState, setAppState,
    role, setRole,
    tab, setTab,
    isDark, setIsDark: handleThemeModeChange,
    themeIndex, setThemeIndex: handleThemeIndexChange,
    chartThemeKey,
    currentUserId,
    userProfile, setUserProfile,
    userReady,
    loadingFinished, setLoadingFinished,
    rememberRole, setRememberRole, handleRememberRoleChange,
    enterpriseOnboarding, setEnterpriseOnboarding,
    investorOnboarding, setInvestorOnboarding,
    isCommandPaletteOpen, setIsCommandPaletteOpen,
    refreshInterval,
    isRefreshing,
    lastDataRefreshAt,
    industryDataVersion,
    unitPrefs,
    dataFormatter,
    onUnitPrefsChange: handleUnitPrefsChange,
    onRefreshData: handleRefreshData,
    onRefreshIntervalChange: handleRefreshIntervalChange,
    prefetchedSessionHistoryRef,
    syncUserProfile,
    applyLocalUserProfilePatch,
    refreshUserProfile,
    persistUserPreferences,
    handleThemeModeChange,
    handleThemeIndexChange,
    handleRoleSelect,
    handleGoApp,
    saveEnterpriseBaseInfo,
    saveInvestorBaseInfo,
    openMem,
    closeMem,
  }), [
    appState, role, tab, isDark, themeIndex, chartThemeKey,
    currentUserId, userProfile, userReady, loadingFinished, rememberRole, handleRememberRoleChange,
    enterpriseOnboarding, investorOnboarding, isCommandPaletteOpen,
    refreshInterval, isRefreshing, lastDataRefreshAt, industryDataVersion,
    unitPrefs, dataFormatter, prefetchedSessionHistoryRef,
    syncUserProfile, applyLocalUserProfilePatch, refreshUserProfile,
    persistUserPreferences, handleThemeModeChange, handleThemeIndexChange,
    handleUnitPrefsChange, handleRefreshData, handleRefreshIntervalChange,
    handleRoleSelect, handleGoApp, saveEnterpriseBaseInfo, saveInvestorBaseInfo,
    openMem, closeMem,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
