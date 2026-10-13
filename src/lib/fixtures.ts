// Loads the local fixtures and validates them. Owned by the logic builder.
import volcanoesRaw from '../../data/volcanoes.json';
import incidentsRaw from '../../data/incidents.json';
import demoEventsRaw from '../../data/demo-events.json';
import type { DemoScenario, Incident, Observation, ReplayStep, ValidationIssue, Volcano } from '../types';
import { validateObservations } from './reviewRules';

export interface Fixtures {
  volcanoes: Volcano[];
  incidents: Incident[];
  scenario: DemoScenario;
  observations: Observation[];
  issues: ValidationIssue[];
  duplicatesIgnored: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReplayStep(value: unknown): value is ReplayStep {
  return (
    isRecord(value) &&
    typeof value.index === 'number' &&
    Number.isInteger(value.index) &&
    value.index >= 0 &&
    typeof value.label === 'string' &&
    typeof value.clock === 'string'
  );
}

/**
 * Normalise the raw scenario block. A missing or empty `replaySteps` (or one with no usable step)
 * falls back to a single Baseline step clocked at the scenario incident's window start.
 */
export function normalizeScenario(raw: unknown, incidents: Incident[]): DemoScenario {
  const obj = isRecord(raw) ? raw : {};
  const incidentId =
    typeof obj.incidentId === 'string' && obj.incidentId !== ''
      ? obj.incidentId
      : (incidents.find((i) => i.replayable)?.id ?? '');
  const steps = (Array.isArray(obj.replaySteps) ? obj.replaySteps : [])
    .filter(isReplayStep)
    .map((s) => ({
      index: s.index,
      label: s.label,
      description: typeof s.description === 'string' ? s.description : '',
      clock: s.clock,
    }))
    .sort((a, b) => a.index - b.index);
  if (steps.length > 0) return { incidentId, replaySteps: steps };

  const incident = incidents.find((i) => i.id === incidentId);
  return {
    incidentId,
    replaySteps: [
      {
        index: 0,
        label: 'Baseline',
        description: 'Baseline observations. No replay steps were configured for this scenario.',
        clock: incident?.scenarioWindow?.start ?? 'not set',
      },
    ],
  };
}

export function loadFixtures(): Fixtures {
  const incidents = (Array.isArray(incidentsRaw) ? incidentsRaw : []) as unknown as Incident[];
  const volcanoes = (Array.isArray(volcanoesRaw) ? volcanoesRaw : []) as unknown as Volcano[];
  const events: Record<string, unknown> = isRecord(demoEventsRaw) ? demoEventsRaw : {};
  const { valid, issues, duplicatesIgnored } = validateObservations(
    events.observations,
    new Set(incidents.map((i) => i.id)),
  );
  return {
    volcanoes,
    incidents,
    scenario: normalizeScenario(events.scenario, incidents),
    observations: valid,
    issues,
    duplicatesIgnored,
  };
}

/** The volcano with this id, or null (also null for a null/undefined id). */
export function findVolcano(volcanoes: Volcano[], id: string | null | undefined): Volcano | null {
  if (!id) return null;
  return volcanoes.find((v) => v.id === id) ?? null;
}

/** Replay steps for an incident, oldest first. Empty for non-replayable or unknown incidents. */
export function replayStepsFor(
  fixtures: Pick<Fixtures, 'incidents' | 'scenario'>,
  incidentId: string,
): ReplayStep[] {
  const incident = fixtures.incidents.find((i) => i.id === incidentId);
  if (!incident || !incident.replayable || fixtures.scenario.incidentId !== incidentId) return [];
  return fixtures.scenario.replaySteps;
}
