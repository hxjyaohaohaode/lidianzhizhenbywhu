export type ProviderStatus = {
  deepseekReasoner: boolean;
  glm5: boolean;
  qwen35Plus: boolean;
};

export type RuntimeSubsystemStatus = "ready" | "degraded" | "unavailable";

export type RuntimeReadiness = {
  status: "ready" | "degraded";
  runMode: "api_only" | "local_fallback";
  canRunWithApiOnly: boolean;
  summary: string;
  warnings: string[];
  subsystems: {
    llm: {
      status: RuntimeSubsystemStatus;
      summary: string;
      availableProviders: Array<keyof ProviderStatus>;
    };
    rag: {
      status: RuntimeSubsystemStatus;
      summary: string;
    };
    dataSources: {
      status: RuntimeSubsystemStatus;
      summary: string;
      eastmoneyMode: "public_connector";
      nbsMode: "credential" | "public_fallback";
    };
    persistence: {
      status: RuntimeSubsystemStatus;
      summary: string;
      mode: "memory" | "file";
    };
    agent: {
      status: RuntimeSubsystemStatus;
      summary: string;
    };
  };
};

export type DeploymentReadiness = {
  privateConfigMode: "server_only";
  canRunWithApiOnly: boolean;
  requiredInputs: string[];
  optionalInputs: string[];
  summary: string;
};

export type HealthResponse = {
  status: "ok" | "degraded";
  service: string;
  version: string;
  environment: string;
  uptimeInSeconds: number;
  configuredProviders: ProviderStatus;
  storage: {
    mode: "memory" | "file";
    persistenceReady: boolean;
    stats?: {
      users: number;
      sessions: number;
      memories: number;
      tasks: number;
      analyses: number;
      workflows: number;
    };
  };
  governance: {
    cacheTtlSeconds: number;
    rateLimitMaxRequests: number;
    asyncTaskConcurrency: number;
    agentBudgetTotalTokens: number;
    ragMaxSourceAgeDays: number;
    backgroundTasksEnabled: boolean;
  };
  configProfile: {
    layer: string;
    healthcheckIncludesDetails: boolean;
  };
  dependencyChecks?: {
    llm: RuntimeSubsystemStatus;
    rag: RuntimeSubsystemStatus;
    dataSources: RuntimeSubsystemStatus;
    persistence: RuntimeSubsystemStatus;
    agent: RuntimeSubsystemStatus;
  };
  runtimeReadiness?: RuntimeReadiness;
  deploymentReadiness?: DeploymentReadiness;
  timestamp: string;
};

export type RoleCard = {
  role: string;
  description: string;
  focus: string[];
};

export type MetaResponse = {
  title: string;
  subtitle: string;
  roles: RoleCard[];
};

export type EnterpriseOnboardingDraft = {
  hasFullHistory: boolean;
  enterpriseName: string;
  currentQuarterLabel: string;
  baselineQuarterLabel: string;
  currentGrossMargin: string;
  currentRevenue: string;
  currentCost: string;
  currentSalesVolume: string;
  currentProductionVolume: string;
  currentInventoryExpense: string;
  currentManufacturingExpense: string;
  currentOperatingCost: string;
  currentOperatingCashFlow: string;
  currentTotalLiabilities: string;
  currentTotalAssets: string;
  baselineGrossMargin: string;
  baselineRevenue: string;
  baselineCost: string;
  baselineSalesVolume: string;
  baselineInventoryExpense: string;
  baselineProductionVolume: string;
  baselineManufacturingExpense: string;
  baselineOperatingCost: string;
  baselineOperatingCashFlow: string;
  baselineTotalLiabilities: string;
  baselineTotalAssets: string;
  previousQuarterGrossMargin: string;
  previousQuarterRevenue: string;
  twoQuartersAgoGrossMargin: string;
  twoQuartersAgoRevenue: string;
  currentNetProfit: string;
  currentBeginNetAssets: string;
  currentEndNetAssets: string;
  currentRevenueForDQI: string;
  currentOCFNet: string;
  baselineNetProfit: string;
  baselineBeginNetAssets: string;
  baselineEndNetAssets: string;
  baselineRevenueForDQI: string;
  baselineOCFNet: string;
};
