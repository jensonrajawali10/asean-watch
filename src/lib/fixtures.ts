// STUB: owned by the logic agent. Loads local fixtures once and validates them.
import volcanoesRaw from '../../data/volcanoes.json';
import incidentsRaw from '../../data/incidents.json';
import demoEventsRaw from '../../data/demo-events.json';
import type { DemoScenario, Incident, Observation, ValidationIssue, Volcano } from '../types';
import { validateObservations } from './reviewRules';

export interface Fixtures {
  volcanoes: Volcano[];
  incidents: Incident[];
  scenario: DemoScenario;
  observations: Observation[];
  issues: ValidationIssue[];
  duplicatesIgnored: number;
}

export function loadFixtures(): Fixtures {
  const incidents = incidentsRaw as unknown as Incident[];
  const { valid, issues, duplicatesIgnored } = validateObservations(
    (demoEventsRaw as { observations: unknown }).observations,
    new Set(incidents.map((i) => i.id)),
  );
  return {
    volcanoes: volcanoesRaw as unknown as Volcano[],
    incidents,
    scenario: (demoEventsRaw as unknown as { scenario: DemoScenario }).scenario,
    observations: valid,
    issues,
    duplicatesIgnored,
  };
}
