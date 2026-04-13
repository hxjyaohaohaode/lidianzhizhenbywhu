process.env.LOG_LEVEL ??= "error";

const { loadServerEnv } = await import("./env.js");
const { DiagnosticWorkflowService } = await import("./agent-service.js");

const env = loadServerEnv();
const service = new DiagnosticWorkflowService(env);

const report = await service.generateMinimumDeploymentAuditReport();

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
