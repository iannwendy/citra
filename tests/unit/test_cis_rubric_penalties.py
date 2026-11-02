"""Task 1.3 — single source of truth for CIS mapping penalties.

CISCalculator must read ``settings.cis.rubric_penalty`` (defaults
0.20/0.10/0.15/0.10/0.05/0.02) and changing settings must change the CIS.
``linking.statuses`` exposes 0–1 *severity* weights under an explicit name.
"""

from __future__ import annotations

import pytest

from integrity_checker.config import RubricPenaltyConfig, Settings
from integrity_checker.linking import MAPPING_SEVERITY
from integrity_checker.linking.statuses import (
    MAPPING_PENALTIES as STATUS_ALIAS,
)
from integrity_checker.linking.statuses import (
    CitationMappingStatus,
    LinkingResult,
)
from integrity_checker.logic.cis import MAPPING_PENALTIES, CISCalculator, rubric_penalties
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.validation import (
    CitationLink,
    CitationVerdict,
    MappingMethod,
    ValidationLabel,
)

EXPECTED_DEFAULTS = {
    "missing_reference": 0.20,
    "uncited_reference": 0.10,
    "in_text_mismatch": 0.15,
    "duplicate_reference": 0.10,
    "ambiguous_mapping": 0.05,
    "style_inconsistent": 0.02,
}


def _verdict(mapping: CitationMappingStatus) -> CitationVerdict:
    c = Citation(raw_text="X (2020). T.", citation_type=CitationType.REFERENCE_LIST)
    return CitationVerdict(citation=c, label=ValidationLabel.VERIFIED, confidence=0.9,
                           mapping_status=mapping)


def _links(statuses: list[CitationMappingStatus]) -> LinkingResult:
    lr = LinkingResult(total_citations=len(statuses))
    for i, st in enumerate(statuses):
        lr.add_link(CitationLink(occurrence_id=f"occ-{i}", reference_id=None, status=st,
                                 confidence=0.0, method=MappingMethod.NO_KEYS))
    return lr


class TestDefaults:
    def test_rubric_penalties_default_to_config_values(self):
        table = rubric_penalties(Settings())
        for key, value in EXPECTED_DEFAULTS.items():
            assert table[key] == pytest.approx(value)
        assert table["matched"] == 0.0 and table["unresolved"] == 0.0

    def test_module_constant_matches_config_defaults(self):
        defaults = RubricPenaltyConfig().model_dump()
        for name, value in defaults.items():
            assert MAPPING_PENALTIES[name.lower()] == pytest.approx(value)
        assert MAPPING_PENALTIES == {**{"matched": 0.0}, **EXPECTED_DEFAULTS}

    def test_calculator_penalties_equal_settings(self):
        calc = CISCalculator(Settings())
        for key, value in EXPECTED_DEFAULTS.items():
            assert calc.penalties[key] == pytest.approx(value)


class TestSettingsDriveCis:
    def test_changing_missing_reference_penalty_changes_consistency(self):
        verdicts = [_verdict(CitationMappingStatus.MATCHED)]
        lr = _links([CitationMappingStatus.MISSING_REFERENCE, CitationMappingStatus.MATCHED])
        default = CISCalculator(Settings()).compute(verdicts, linking_result=lr)
        harsh = CISCalculator(
            Settings(cis={"rubric_penalty": {"MISSING_REFERENCE": 1.0}})
        ).compute(verdicts, linking_result=lr)
        assert default.components.in_text_bib_consistency == pytest.approx(1 - 0.20 / 2)
        assert harsh.components.in_text_bib_consistency == pytest.approx(1 - 1.0 / 2)
        assert harsh.score < default.score

    def test_zero_penalty_setting_removes_penalty(self):
        verdicts = [_verdict(CitationMappingStatus.MATCHED)]
        lr = _links([CitationMappingStatus.STYLE_INCONSISTENT])
        none = CISCalculator(
            Settings(cis={"rubric_penalty": {"STYLE_INCONSISTENT": 0.0}})
        ).compute(verdicts, linking_result=lr)
        assert none.components.in_text_bib_consistency == pytest.approx(1.0)

    def test_verdict_fallback_strategy_uses_settings(self):
        verdicts = [_verdict(CitationMappingStatus.UNCITED_REFERENCE),
                    _verdict(CitationMappingStatus.MATCHED)]
        calc = CISCalculator(Settings(cis={"rubric_penalty": {"UNCITED_REFERENCE": 0.5}}))
        result = calc.compute(verdicts, linking_result=None)
        assert result.components.in_text_bib_consistency == pytest.approx(1 - 0.5 / 2)

    def test_duplicate_penalty_from_settings(self):
        verdicts = [_verdict(CitationMappingStatus.MATCHED),
                    _verdict(CitationMappingStatus.DUPLICATE_REFERENCE)]
        lr = LinkingResult(total_references=2, duplicate_reference_ids=["ref-0002"])
        lr.links = []
        r = CISCalculator(Settings(cis={"rubric_penalty": {"DUPLICATE_REFERENCE": 0.4}})).compute(
            verdicts, linking_result=lr
        )
        assert r.components.in_text_bib_consistency == pytest.approx(1 - 0.4 / 1)


class TestSeverityNaming:
    def test_severity_is_distinct_from_cis_penalty(self):
        assert MAPPING_SEVERITY[CitationMappingStatus.MISSING_REFERENCE] == 1.0
        assert CitationMappingStatus.MISSING_REFERENCE.severity == 1.0
        # The CIS penalty for the same status is the rubric value, not the severity.
        assert rubric_penalties(Settings())["missing_reference"] == pytest.approx(0.20)

    def test_deprecated_aliases_still_work(self):
        assert STATUS_ALIAS is MAPPING_SEVERITY
        for st in CitationMappingStatus:
            assert st.penalty == st.severity == MAPPING_SEVERITY[st]

    def test_severity_ordering_consistent_with_rubric_ordering_extremes(self):
        rubric = rubric_penalties(Settings())
        worst_rubric = max(EXPECTED_DEFAULTS, key=lambda k: rubric[k])
        worst_sev = max(
            (s for s in CitationMappingStatus if s.value in EXPECTED_DEFAULTS),
            key=lambda s: s.severity,
        )
        assert worst_rubric == worst_sev.value == "missing_reference"
        assert all(MAPPING_SEVERITY[s] == 0.0 for s in
                   (CitationMappingStatus.MATCHED, CitationMappingStatus.UNRESOLVED))


def test_repository_recalculation_uses_settings_penalties(monkeypatch):
    """Repository.recalculate_essay_cis imports rubric_penalties (no stale table)."""
    import inspect

    from integrity_checker.db import repository

    src = inspect.getsource(repository.Repository.recalculate_essay_cis)
    assert "rubric_penalties" in src
    assert "MAPPING_PENALTIES" not in src
