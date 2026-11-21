.PHONY: help setup sample demo api web test test-unit test-integration lint typecheck format clean

# --- Default ---
help:
	@echo "CITRA (Essay Integrity Checker) — common commands"
	@echo ""
	@echo "  make setup            Create .venv, install CPU PyTorch + [dev,onnx] deps & git hooks"
	@echo "  make sample           Generate sample essays"
	@echo "  make demo             Run CLI demo on a sample PDF"
	@echo "  make api              Run FastAPI backend (uvicorn --reload)"
	@echo "  make web              Run Vite dev server (frontend)"
	@echo "  make test             Run full pytest suite"
	@echo "  make test-unit        Run unit pytest suite"
	@echo "  make test-integration Run integration pytest suite"
	@echo "  make lint             Run ruff lint across src/, tests/, and scripts/"
	@echo "  make typecheck        Run mypy static type checking across src/integrity_checker"
	@echo "  make format           Auto-fix & format code with ruff"
	@echo "  make clean            Remove caches + generated temporary artifacts"

# --- Setup ---
setup:
	python3 -m venv .venv
	. .venv/bin/activate && pip install --upgrade pip && pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install -r requirements-dev.txt && pip install --no-build-isolation -e ".[dev,onnx]"
	git config core.hooksPath .githooks || true
	cp -n .env.example .env || true
	cp -n configs/config.example.yaml configs/config.yaml || true

# --- Sample data ---
sample:
	. .venv/bin/activate && python scripts/gen_sample_essays.py

# --- Demo ---
demo:
	. .venv/bin/activate && python -m integrity_checker.pipeline.integrity_pipeline \
	    data/essays/essay_02_mixed.pdf --output report.json

# --- Services ---
api:
	. .venv/bin/activate && uvicorn integrity_checker.api.main:app --reload --reload-dir src --port 8000

web:
	cd web && npm install && npm run dev

# --- Tests ---
test:
	. .venv/bin/activate && pytest tests/ -v

test-unit:
	. .venv/bin/activate && pytest tests/unit/ -v

test-integration:
	. .venv/bin/activate && pytest tests/integration/ -v

# --- Lint, Typecheck & Format ---
lint:
	. .venv/bin/activate && ruff check src/ tests/ scripts/

typecheck:
	. .venv/bin/activate && mypy src/integrity_checker

format:
	. .venv/bin/activate && ruff check --fix src/ tests/ scripts/
	. .venv/bin/activate && ruff format src/ tests/ scripts/

# --- Cleanup ---
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -not -path "./web/node_modules/*" -delete 2>/dev/null || true
	rm -rf .pytest_cache .mypy_cache .ruff_cache htmlcov .coverage
	rm -rf data/cache/*.json data/cache/*.sqlite data/cache/grobid/*.tei.xml
