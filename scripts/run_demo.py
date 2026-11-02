#!/usr/bin/env python
"""Run demo end-to-end — wrapper gọn cho `python scripts/run_demo.py`.

Tương đương:
    python -m integrity_checker.pipeline.integrity_pipeline data/essays/essay_02_mixed.pdf --output report.json
"""

from integrity_checker.pipeline.integrity_pipeline import main

if __name__ == "__main__":
    main()
