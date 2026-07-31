-- Built-in agents never made a deliberate provider choice: 'mock' was the
-- hardcoded default in `src/lib/agents/definitions.ts`, not a user pin. While it
-- was stored, DEFAULT_LLM_PROVIDER could never take effect — every node resolved
-- its own explicit 'mock'. Clearing it lets built-ins inherit the env default.
--
-- Rows a user deliberately pinned (isBuiltIn = false) are left alone.
UPDATE "AgentConfiguration" SET "provider" = NULL WHERE "isBuiltIn" = true;
