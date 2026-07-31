import { prisma } from '@/lib/db';
import { AGENT_DEFINITIONS, AGENT_META, ALL_AGENT_DEFINITIONS } from '@/lib/agents/definitions';
import { getProviderStatuses, type ProviderStatus } from '@/lib/providers/registry';
import { agentTypeSchema, type AgentConfig, type AgentType } from '@/types/agent';
import { toAgentConfig } from './mappers';

/**
 * Agent catalogue.
 *
 * Reads the persisted `AgentConfiguration` rows and falls back to the built-in
 * definitions for any type that hasn't been customised — so the palette is
 * never empty even before the seed has run.
 */

export interface AgentCatalogEntry extends AgentConfig {
  accent: string;
  icon: string;
  category: string;
  isBuiltIn: boolean;
}

export async function listAgents(): Promise<AgentCatalogEntry[]> {
  const rows = await prisma.agentConfiguration.findMany();

  const overrides = new Map<AgentType, AgentConfig>();
  const builtInFlags = new Map<AgentType, boolean>();

  for (const row of rows) {
    const parsed = agentTypeSchema.safeParse(row.agentType);
    if (!parsed.success) continue;
    overrides.set(parsed.data, toAgentConfig(row));
    builtInFlags.set(parsed.data, row.isBuiltIn);
  }

  return ALL_AGENT_DEFINITIONS.map((definition) => {
    const config = overrides.get(definition.type) ?? definition;
    const meta = AGENT_META[definition.type];

    return {
      ...config,
      accent: meta.accent,
      icon: meta.icon,
      category: meta.category,
      isBuiltIn: builtInFlags.get(definition.type) ?? true,
    };
  });
}

/**
 * Effective defaults keyed by type, for the engine.
 *
 * Falls back to the built-ins on any DB error: a workflow run should not fail
 * because the configuration table is unreachable.
 */
export async function getAgentDefaults(): Promise<Record<AgentType, AgentConfig>> {
  const defaults = { ...AGENT_DEFINITIONS };

  try {
    const rows = await prisma.agentConfiguration.findMany();
    for (const row of rows) {
      const parsed = agentTypeSchema.safeParse(row.agentType);
      if (!parsed.success) continue;
      defaults[parsed.data] = toAgentConfig(row);
    }
  } catch {
    return { ...AGENT_DEFINITIONS };
  }

  return defaults;
}

export function getProviders(): ProviderStatus[] {
  return getProviderStatuses();
}
