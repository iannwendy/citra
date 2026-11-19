import { describe, it, expect, vi } from 'vitest';
import {
  SCHOLARLY_APIS_LABEL,
  SYMBOLIC_RULES_COUNT,
  SYMBOLIC_RULES_RANGE,
  LOCAL_PAPERS_LABEL,
  CITATION_STYLES_COUNT,
  IS_DEMO_EVALUATOR_MODE,
  isDemoEvaluatorMode,
} from './productFacts';
import { RULE_DEFINITIONS } from '@/components/RuleInspector';
import en from '@/i18n/locales/en.json';
import viLocale from '@/i18n/locales/vi.json';

describe('productFacts canonical constants', () => {
  it('exports canonical scholarly APIs and symbolic rules constants', () => {
    expect(SCHOLARLY_APIS_LABEL).toBe('15+');
    expect(SYMBOLIC_RULES_COUNT).toBe(30);
    expect(SYMBOLIC_RULES_RANGE).toBe('R01–R30');
    expect(LOCAL_PAPERS_LABEL).toBe('128K+');
    expect(CITATION_STYLES_COUNT).toBe(12);
  });

  it('aligns RULE_DEFINITIONS with at least SYMBOLIC_RULES_COUNT backend R- rules', () => {
    const rRuleKeys = Object.keys(RULE_DEFINITIONS).filter((k) => k.startsWith('R-'));
    expect(rRuleKeys.length).toBeGreaterThanOrEqual(SYMBOLIC_RULES_COUNT);
  });

  it('uses 15+ in localized auth.featureRetrievalDesc', () => {
    expect(en.auth.featureRetrievalDesc).toContain(SCHOLARLY_APIS_LABEL);
    expect(viLocale.auth.featureRetrievalDesc).toContain(SCHOLARLY_APIS_LABEL);
  });

  it('defaults IS_DEMO_EVALUATOR_MODE to false when VITE_DEMO_MODE is unset and evaluates isDemoEvaluatorMode strictly', async () => {
    expect(IS_DEMO_EVALUATOR_MODE).toBe(false);
    expect(isDemoEvaluatorMode(undefined)).toBe(false);
    expect(isDemoEvaluatorMode('')).toBe(false);
    expect(isDemoEvaluatorMode('false')).toBe(false);
    expect(isDemoEvaluatorMode('1')).toBe(false);
    expect(isDemoEvaluatorMode('TRUE')).toBe(false);
    expect(isDemoEvaluatorMode('true')).toBe(true);

    try {
      vi.stubEnv('VITE_DEMO_MODE', 'true');
      vi.resetModules();
      const reloaded = await import('./productFacts');
      expect(reloaded.IS_DEMO_EVALUATOR_MODE).toBe(true);
      expect(reloaded.isDemoEvaluatorMode()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
