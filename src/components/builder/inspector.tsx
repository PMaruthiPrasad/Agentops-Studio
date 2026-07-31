'use client';

import { MousePointerSquareDashed, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_DEFINITIONS } from '@/lib/agents/definitions';
import { getAgentAccent, getAgentIcon } from '@/lib/agent-ui';
import {
  selectSelectedEdge,
  selectSelectedNode,
  useBuilderStore,
} from '@/stores/builder-store';
import { PROVIDER_IDS, type ProviderId } from '@/types/provider';
import {
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  type ConditionField,
  type ConditionOperator,
} from '@/types/workflow';
import { cn, formatCost, formatDuration, titleCase } from '@/lib/utils';
import { explainCondition, OPERATOR_LABEL } from './condition-format';

/**
 * Right-hand inspector.
 *
 * Every field is an *override*: leaving one untouched means the node inherits
 * its agent type's default, and the placeholder shows what that default is. So
 * the panel reads as "what's different about this node" rather than a wall of
 * duplicated configuration.
 */
export function Inspector() {
  const node = useBuilderStore(selectSelectedNode);
  const edge = useBuilderStore(selectSelectedEdge);

  const updateNode = useBuilderStore((state) => state.updateNode);
  const updateNodeConfig = useBuilderStore((state) => state.updateNodeConfig);
  const removeNodes = useBuilderStore((state) => state.removeNodes);
  const updateEdge = useBuilderStore((state) => state.updateEdge);
  const removeEdges = useBuilderStore((state) => state.removeEdges);

  if (edge && !node) {
    const condition = edge.condition;

    return (
      <aside className="flex h-full flex-col border-l border-border bg-card/40">
        <header className="border-b border-border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Connection
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{edge.id}</p>
        </header>

        <ScrollArea className="flex-1">
          <div className="space-y-4 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="edge-kind">Condition</Label>
              <Select
                value={condition.kind}
                onValueChange={(kind) =>
                  updateEdge(edge.id, {
                    condition:
                      kind === 'always'
                        ? { kind: 'always' }
                        : { kind: 'expression', field: 'confidence', operator: 'gte', value: 0.7 },
                  })
                }
              >
                <SelectTrigger id="edge-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">Always</SelectItem>
                  <SelectItem value="expression">Only when…</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {condition.kind === 'expression' ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edge-field">Source field</Label>
                  <Select
                    value={condition.field}
                    onValueChange={(field) =>
                      updateEdge(edge.id, {
                        condition: { ...condition, field: field as ConditionField },
                      })
                    }
                  >
                    <SelectTrigger id="edge-field">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_FIELDS.map((field) => (
                        <SelectItem key={field} value={field}>
                          {field}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edge-operator">Operator</Label>
                  <Select
                    value={condition.operator}
                    onValueChange={(operator) =>
                      updateEdge(edge.id, {
                        condition: { ...condition, operator: operator as ConditionOperator },
                      })
                    }
                  >
                    <SelectTrigger id="edge-operator">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_OPERATORS.map((operator) => (
                        <SelectItem key={operator} value={operator}>
                          {OPERATOR_LABEL[operator]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edge-value">Value</Label>
                  <Input
                    id="edge-value"
                    value={String(condition.value)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      // Numeric fields must compare as numbers, or `0.9 > 0.75`
                      // silently becomes a string comparison and fails.
                      const numeric = Number(raw);
                      const value =
                        raw !== '' && !Number.isNaN(numeric) && condition.field !== 'output'
                          ? numeric
                          : raw;
                      updateEdge(edge.id, { condition: { ...condition, value } });
                    }}
                  />
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {explainCondition(condition)}
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="edge-label">Label</Label>
              <Input
                id="edge-label"
                value={edge.label ?? ''}
                placeholder="Optional"
                maxLength={80}
                onChange={(event) => updateEdge(edge.id, { label: event.target.value })}
              />
            </div>

            <Separator />

            <Button
              variant="outline"
              size="sm"
              className="w-full text-destructive"
              onClick={() => removeEdges([edge.id])}
            >
              <Trash2 />
              Delete connection
            </Button>
          </div>
        </ScrollArea>
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className="flex h-full flex-col items-center justify-center border-l border-border bg-card/40 p-6 text-center">
        <MousePointerSquareDashed className="size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Nothing selected</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Select a node or a connection to edit it.
        </p>
      </aside>
    );
  }

  const definition = AGENT_DEFINITIONS[node.type];
  const Icon = getAgentIcon(node.type);
  const accent = getAgentAccent(node.type);
  const config = node.config;

  return (
    <aside className="flex h-full flex-col border-l border-border bg-card/40">
      <header className="flex items-start gap-2.5 border-b border-border p-3">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', accent.chip)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{node.label}</p>
          <p className="tabular truncate text-[11px] text-muted-foreground">
            {definition.name} · ~{formatDuration(definition.estimatedLatencyMs)} ·{' '}
            {formatCost(definition.estimatedCostUsd)}
          </p>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="node-label">Label</Label>
            <Input
              id="node-label"
              value={node.label}
              maxLength={80}
              onChange={(event) => updateNode(node.id, { label: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="node-description">Description</Label>
            <Textarea
              id="node-description"
              value={node.description}
              rows={2}
              maxLength={500}
              placeholder={definition.description}
              onChange={(event) => updateNode(node.id, { description: event.target.value })}
            />
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="node-prompt">System prompt override</Label>
            <Textarea
              id="node-prompt"
              value={config.systemPrompt ?? ''}
              rows={6}
              placeholder={definition.systemPrompt}
              className="font-mono text-[11px] leading-relaxed"
              onChange={(event) =>
                updateNodeConfig(node.id, { systemPrompt: event.target.value || undefined })
              }
            />
            {config.systemPrompt ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-xs"
                onClick={() => updateNodeConfig(node.id, { systemPrompt: undefined })}
              >
                <RotateCcw />
                Reset to default
              </Button>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="node-temperature">Temperature</Label>
              <span className="tabular text-xs text-muted-foreground">
                {(config.temperature ?? definition.temperature).toFixed(2)}
                {config.temperature === undefined ? ' (default)' : ''}
              </span>
            </div>
            <Slider
              id="node-temperature"
              min={0}
              max={2}
              step={0.05}
              value={[config.temperature ?? definition.temperature]}
              onValueChange={([value]) => updateNodeConfig(node.id, { temperature: value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="node-max-tokens">Max tokens</Label>
              <Input
                id="node-max-tokens"
                type="number"
                min={64}
                max={32_000}
                value={config.maxTokens ?? ''}
                placeholder={String(definition.maxTokens)}
                onChange={(event) =>
                  updateNodeConfig(node.id, {
                    maxTokens: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="node-attempts">Max attempts</Label>
              <Input
                id="node-attempts"
                type="number"
                min={1}
                max={5}
                value={config.maxAttempts ?? ''}
                placeholder="default"
                onChange={(event) =>
                  updateNodeConfig(node.id, {
                    maxAttempts: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="node-provider">Provider</Label>
            <Select
              value={config.provider ?? 'inherit'}
              onValueChange={(value) =>
                updateNodeConfig(node.id, {
                  provider: value === 'inherit' ? undefined : (value as ProviderId),
                })
              }
            >
              <SelectTrigger id="node-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">
                  Inherit ({definition.provider ?? 'env default'})
                </SelectItem>
                {PROVIDER_IDS.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {titleCase(provider)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Falls back to the mock provider automatically when no API key is set.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="node-notes">Notes</Label>
            <Textarea
              id="node-notes"
              value={config.notes ?? ''}
              rows={2}
              maxLength={1_000}
              placeholder="Why this node exists, caveats, links…"
              onChange={(event) =>
                updateNodeConfig(node.id, { notes: event.target.value || undefined })
              }
            />
          </div>

          <Separator />

          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive"
            onClick={() => removeNodes([node.id])}
          >
            <Trash2 />
            Delete node
          </Button>
        </div>
      </ScrollArea>
    </aside>
  );
}
