-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "systemPrompt" TEXT NOT NULL,
    "temperature" REAL NOT NULL DEFAULT 0.4,
    "maxTokens" INTEGER NOT NULL DEFAULT 1500,
    "provider" TEXT,
    "model" TEXT,
    "estimatedCostUsd" REAL NOT NULL DEFAULT 0,
    "estimatedLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AgentConfiguration" ("agentType", "createdAt", "description", "estimatedCostUsd", "estimatedLatencyMs", "id", "isBuiltIn", "maxTokens", "model", "name", "provider", "systemPrompt", "temperature", "updatedAt") SELECT "agentType", "createdAt", "description", "estimatedCostUsd", "estimatedLatencyMs", "id", "isBuiltIn", "maxTokens", "model", "name", "provider", "systemPrompt", "temperature", "updatedAt" FROM "AgentConfiguration";
DROP TABLE "AgentConfiguration";
ALTER TABLE "new_AgentConfiguration" RENAME TO "AgentConfiguration";
CREATE UNIQUE INDEX "AgentConfiguration_agentType_key" ON "AgentConfiguration"("agentType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
