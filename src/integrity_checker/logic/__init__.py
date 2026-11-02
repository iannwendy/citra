"""Logic module — Neuro-Symbolic checker + CIS aggregation.

Bao gồm:
- SymbolicRules (decision table)
- NeuroSymbolicChecker (orchestrator)
- Calibration (ECE / Brier / abstention)
- CIS (Citation Integrity Score aggregator)
- Explanation (natural-language explanation)
"""

from integrity_checker.logic.calibration import CalibrationMetrics
from integrity_checker.logic.cis import CISCalculator
from integrity_checker.logic.explanation import ExplanationGenerator
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules

__all__ = [
    "SymbolicRules",
    "NeuroSymbolicChecker",
    "CalibrationMetrics",
    "CISCalculator",
    "ExplanationGenerator",
]
