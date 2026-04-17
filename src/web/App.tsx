import React from "react";
import { AppProvider, useAppContext } from "./context/AppContext.js";
import { LoadingScreen } from "./components/LoadingScreen.js";
import { RoleScreen } from "./components/RoleScreen.js";
import { CollectEnterpriseScreen } from "./components/CollectEnterpriseScreen.js";
import { CollectInvestorScreen } from "./components/CollectInvestorScreen.js";
import { AppEnterpriseScreen } from "./components/EnterpriseScreen.js";
import { AppInvestorScreen } from "./components/InvestorScreen.js";
import { MemoryScreen } from "./components/MemoryScreen.js";
import { CommandPalette } from "./components/CommandPalette.js";

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean; error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = {hasError: false, error: null};
  }
  static getDerivedStateFromError(error: Error) {
    return {hasError: true, error};
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding: 32, textAlign: "center", color: "var(--t1)"}}>
          <h2>页面渲染异常</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({hasError: false, error: null})} style={{padding: "8px 24px", cursor: "pointer"}}>重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppShell() {
  const ctx = useAppContext();

  return (
    <div className="app-root" data-theme-mode={ctx.isDark ? "dark" : "light"} data-app-state={ctx.appState}>
      <div className="noise-overlay"></div>

      {ctx.appState === 'loading' && (
        <div className="S on" id="ld">
          <LoadingScreen onVideoEnd={() => ctx.setLoadingFinished(true)} />
        </div>
      )}

      {ctx.appState === 'role' && (
        <div className="S on" id="role">
          <RoleScreen onSelect={ctx.handleRoleSelect} />
        </div>
      )}

      {ctx.appState === 'collect-e' && (
        <div className="S on" id="ce">
          <CollectEnterpriseScreen draft={ctx.enterpriseOnboarding} setDraft={ctx.setEnterpriseOnboarding} onFinish={() => ctx.handleGoApp('e')} />
        </div>
      )}

      {ctx.appState === 'collect-i' && (
        <div className="S on" id="ci">
          <CollectInvestorScreen draft={ctx.investorOnboarding} setDraft={ctx.setInvestorOnboarding} onFinish={() => ctx.handleGoApp('i')} />
        </div>
      )}

      {ctx.appState === 'app-e' && (
        <div className="S on" id="ae">
          <AppEnterpriseScreen
            tab={ctx.tab}
            setTab={ctx.setTab}
            openMem={ctx.openMem}
            isDark={ctx.isDark}
            setIsDark={ctx.setIsDark}
            themeIndex={ctx.themeIndex}
            setThemeIndex={ctx.setThemeIndex}
            currentUserId={ctx.currentUserId}
            enterpriseOnboarding={ctx.enterpriseOnboarding}
            userProfile={ctx.userProfile}
            refreshUserProfile={ctx.refreshUserProfile}
            saveEnterpriseBaseInfo={ctx.saveEnterpriseBaseInfo}
            unitPrefs={ctx.unitPrefs}
            dataFormatter={ctx.dataFormatter}
            onUnitPrefsChange={ctx.onUnitPrefsChange}
            isRefreshing={ctx.isRefreshing}
            lastDataRefreshAt={ctx.lastDataRefreshAt}
            onRefreshData={ctx.onRefreshData}
            refreshInterval={ctx.refreshInterval}
            onRefreshIntervalChange={ctx.onRefreshIntervalChange}
            chartThemeKey={ctx.chartThemeKey}
          />
        </div>
      )}

      {ctx.appState === 'app-i' && (
        <div className="S on" id="ai2">
          <AppInvestorScreen
            tab={ctx.tab}
            setTab={ctx.setTab}
            openMem={ctx.openMem}
            isDark={ctx.isDark}
            setIsDark={ctx.setIsDark}
            themeIndex={ctx.themeIndex}
            setThemeIndex={ctx.setThemeIndex}
            currentUserId={ctx.currentUserId}
            userProfile={ctx.userProfile}
            refreshUserProfile={ctx.refreshUserProfile}
            investorOnboarding={ctx.investorOnboarding}
            saveInvestorBaseInfo={ctx.saveInvestorBaseInfo}
            unitPrefs={ctx.unitPrefs}
            dataFormatter={ctx.dataFormatter}
            onUnitPrefsChange={ctx.onUnitPrefsChange}
            isRefreshing={ctx.isRefreshing}
            lastDataRefreshAt={ctx.lastDataRefreshAt}
            onRefreshData={ctx.onRefreshData}
            refreshInterval={ctx.refreshInterval}
            onRefreshIntervalChange={ctx.onRefreshIntervalChange}
            prefetchedSessionHistoryRef={ctx.prefetchedSessionHistoryRef}
            chartThemeKey={ctx.chartThemeKey}
          />
        </div>
      )}

      {ctx.appState === 'mem' && (
        <div className="S on" id="mem">
          <MemoryScreen
            onClose={ctx.closeMem}
            role={ctx.role}
            isDark={ctx.isDark}
            themeIndex={ctx.themeIndex}
            userProfile={ctx.userProfile}
            currentUserId={ctx.currentUserId}
            refreshUserProfile={ctx.refreshUserProfile}
          />
        </div>
      )}

      <CommandPalette isOpen={ctx.isCommandPaletteOpen} onClose={() => ctx.setIsCommandPaletteOpen(false)} userProfile={ctx.userProfile} />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </ErrorBoundary>
  );
}
