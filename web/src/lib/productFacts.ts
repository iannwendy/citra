/**
 * Canonical product & architecture constants for CITRA.
 * Keeps marketing copy, onboarding shells, and diagnostic telemetry aligned.
 */

export const SCHOLARLY_APIS_LABEL = '15+';
export const SYMBOLIC_RULES_COUNT = 30;
export const SYMBOLIC_RULES_RANGE = 'R01–R30';
export const LOCAL_PAPERS_LABEL = '128K+';
export const CITATION_STYLES_COUNT = 12;

export function isDemoEvaluatorMode(
  envFlag: unknown = import.meta.env.VITE_DEMO_MODE,
): boolean {
  return envFlag === 'true';
}

export const IS_DEMO_EVALUATOR_MODE: boolean =
  import.meta.env.VITE_DEMO_MODE === 'true';
