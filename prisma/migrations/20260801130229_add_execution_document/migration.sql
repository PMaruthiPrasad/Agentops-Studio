-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Execution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "workflowName" TEXT NOT NULL DEFAULT '',
    "task" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCostUsd" REAL NOT NULL DEFAULT 0,
    "successRate" REAL NOT NULL DEFAULT 0,
    "averageConfidence" REAL NOT NULL DEFAULT 0,
    "averageLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "edgeCount" INTEGER NOT NULL DEFAULT 0,
    "layerCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "parallelizationScore" REAL NOT NULL DEFAULT 0,
    "complexityScore" REAL NOT NULL DEFAULT 0,
    "error" TEXT,
    "graphSnapshot" TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    "documentName" TEXT,
    "documentText" TEXT,
    "documentPages" INTEGER NOT NULL DEFAULT 0,
    "documentTruncated" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Execution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Execution" ("averageConfidence", "averageLatencyMs", "completedAt", "completionTokens", "complexityScore", "durationMs", "edgeCount", "error", "graphSnapshot", "id", "layerCount", "nodeCount", "parallelizationScore", "promptTokens", "retryCount", "startedAt", "status", "successRate", "task", "totalCostUsd", "totalTokens", "workflowId", "workflowName") SELECT "averageConfidence", "averageLatencyMs", "completedAt", "completionTokens", "complexityScore", "durationMs", "edgeCount", "error", "graphSnapshot", "id", "layerCount", "nodeCount", "parallelizationScore", "promptTokens", "retryCount", "startedAt", "status", "successRate", "task", "totalCostUsd", "totalTokens", "workflowId", "workflowName" FROM "Execution";
DROP TABLE "Execution";
ALTER TABLE "new_Execution" RENAME TO "Execution";
CREATE INDEX "Execution_workflowId_idx" ON "Execution"("workflowId");
CREATE INDEX "Execution_startedAt_idx" ON "Execution"("startedAt");
CREATE INDEX "Execution_status_idx" ON "Execution"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
