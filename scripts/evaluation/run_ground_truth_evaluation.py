#!/usr/bin/env python3
"""End-to-End Ground-Truth Evaluation on Raw Bibliography Strings.

Evaluates the ACTUAL production pipeline stages end-to-end:
    Raw Bibliography String
        -> VNLegalParser (`parse_vn_legal_reference`) / `ReferenceListParser`
        -> `RetrievalOrchestrator` (`--mode offline` deterministic or `--mode live` 15-API network)
        -> `NeuroSymbolicChecker` (Neural SBERT alignment + 30 Symbolic Rules + Platt Calibration)

Reports:
    1. Canonical 5-Class End-to-End Metrics (`verified`, `metadata_error`,
       `suspected_hallucination`, `unresolved`, `resource`) — never conflating
       `ValidationLabel.RESOURCE` with `verified`.
    2. Canonical 4-Class Scholarly Metrics (cleanly excluding `resource` items).
    3. Per-Citation-Style and Per-Domain accuracy & Macro-F1 breakdowns.
    4. Confidence Calibration (`CalibrationCalculator`: ECE & Brier score).

Usage:
    python scripts/evaluation/run_ground_truth_evaluation.py --mode offline
    python scripts/evaluation/run_ground_truth_evaluation.py --mode offline --dataset data/essays/adversarial_ground_truth.json
    python scripts/evaluation/run_ground_truth_evaluation.py --mode live [--limit N]
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import dataclasses
import json
import os
import re
import sqlite3
import sys
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))


def _enable_local_hf_offline_if_cached() -> None:
    """Avoid HuggingFace Hub network metadata pings in offline mode when models are cached locally."""
    hf_hub_cache = Path(
        os.environ.get("HF_HUB_CACHE")
        or (Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub")
    )
    en_cached = (hf_hub_cache / "models--sentence-transformers--all-MiniLM-L6-v2").is_dir()
    xl_cached = (
        hf_hub_cache / "models--sentence-transformers--paraphrase-multilingual-MiniLM-L12-v2"
    ).is_dir()
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    if en_cached and xl_cached:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


from integrity_checker.database.local_db import DEFAULT_DB_PATH, LocalDatabase  # noqa: E402
from integrity_checker.database.models import Paper  # noqa: E402
from integrity_checker.evaluation.metrics import MetricsCalculator  # noqa: E402
from integrity_checker.evaluation.report import EvaluationReport  # noqa: E402
from integrity_checker.extraction.patterns.apa import parse_vn_legal_reference  # noqa: E402
from integrity_checker.extraction.reference_parser import ReferenceListParser  # noqa: E402
from integrity_checker.logic.calibration import CalibrationCalculator  # noqa: E402
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker  # noqa: E402
from integrity_checker.logic.rules import _is_fake_url  # noqa: E402
from integrity_checker.models.citation import Citation  # noqa: E402
from integrity_checker.models.source import SourceCandidate, SourceResult  # noqa: E402
from integrity_checker.retrieval.arxiv_client import ArxivClient  # noqa: E402
from integrity_checker.retrieval.base import BaseScholarClient  # noqa: E402
from integrity_checker.retrieval.doi_ra_client import DoiRaClient  # noqa: E402
from integrity_checker.retrieval.huggingface_client import HuggingFaceClient  # noqa: E402
from integrity_checker.retrieval.link_validator import (  # noqa: E402
    LinkCheckResult,
    LinkStatus,
    clean_extracted_url,
)
from integrity_checker.retrieval.normalization import (  # noqa: E402
    author_match_score,
    normalize_arxiv_id,
    normalize_doi,
    title_similarity,
)
from integrity_checker.retrieval.rate_limiter import RateLimiter  # noqa: E402
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator  # noqa: E402
from integrity_checker.retrieval.tech_standard_client import TechStandardClient  # noqa: E402
from integrity_checker.retrieval.wikidata_opencitations_client import (  # noqa: E402
    WikidataOpenCitationsClient,
)

CANONICAL_5_LABELS: tuple[str, ...] = (
    "verified",
    "metadata_error",
    "suspected_hallucination",
    "unresolved",
    "resource",
)
SCHOLARLY_4_LABELS: tuple[str, ...] = (
    "verified",
    "metadata_error",
    "suspected_hallucination",
    "unresolved",
)

_LABEL_ALIASES: dict[str, str] = {
    "real": "verified",
    "verified": "verified",
    "metadata_error": "metadata_error",
    "hallucinated": "suspected_hallucination",
    "hallucination": "suspected_hallucination",
    "suspected_hallucination": "suspected_hallucination",
    "unresolved": "unresolved",
    "resource": "resource",
}


def _normalize_eval_label(raw_label: str) -> str:
    """Normalize dataset ground-truth labels without collapsing `resource` into `verified`."""
    key = str(raw_label or "").strip().lower()
    return _LABEL_ALIASES.get(key, "unresolved")


def parse_raw_bibliography(
    raw_text: str,
    ref_parser: ReferenceListParser | None = None,
) -> Citation:
    """Parse a raw bibliography string using the exact production extraction hierarchy.

    Order of precedence (matching `IntegrityPipeline`):
        1. `parse_vn_legal_reference(raw_text)` for Vietnamese statutes/decrees/circulars.
        2. `ReferenceListParser().parse_single_entry(raw_text)` (or `.parse_single` if present).
        3. `Citation.from_raw(raw_text)` fallback only when structured parsing returns `None`.
    """
    cleaned = (raw_text or "").strip()
    if not cleaned:
        return Citation.from_raw("")

    legal_cit = parse_vn_legal_reference(cleaned)
    if legal_cit is not None:
        return legal_cit

    parser = ref_parser or ReferenceListParser()
    parse_fn = getattr(parser, "parse_single", None) or getattr(parser, "parse_single_entry", None)
    parsed_cit = parse_fn(cleaned) if callable(parse_fn) else None
    citation = parsed_cit if parsed_cit is not None else Citation.from_raw(cleaned)

    extracted_arxiv = ArxivClient.extract_arxiv_id(citation)
    if extracted_arxiv and not getattr(citation, "arxiv_id", None):
        citation.arxiv_id = extracted_arxiv  # type: ignore[attr-defined]
    return citation


# ============================================================================
# Deterministic Offline Canonical Registry (Zero Label-Oracle Knowledge)
# ============================================================================
# Contains ONLY canonical bibliographic metadata of real published works, RFCs,
# and software packages so `--mode offline` runs in < 5s in CI and defense rooms
# without external network calls and without ever reading `expected_label`.

OFFLINE_CANONICAL_SCHOLARLY_CATALOG: tuple[dict[str, Any], ...] = (
    # --- Domain 1: Computer Science & AI/NLP ---
    {
        "doi": "10.48550/arXiv.1706.03762",
        "arxiv_id": "1706.03762",
        "title": "Attention Is All You Need",
        "authors": [
            "Ashish Vaswani",
            "Noam Shazeer",
            "Niki Parmar",
            "Jakob Uszkoreit",
            "Llion Jones",
            "Aidan N. Gomez",
            "Lukasz Kaiser",
            "Illia Polosukhin",
        ],
        "year": "2017",
        "venue": "Advances in Neural Information Processing Systems",
        "abstract": (
            "The dominant sequence transduction models are based on complex recurrent or "
            "convolutional neural networks that include an encoder and a decoder. We propose "
            "a new simple network architecture, the Transformer, based solely on attention "
            "mechanisms, dispensing with recurrence and convolutions entirely."
        ),
    },
    {
        "doi": "10.1109/CVPR.2016.90",
        "title": "Deep Residual Learning for Image Recognition",
        "authors": ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
        "year": "2016",
        "venue": "Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
        "abstract": (
            "Deeper neural networks are more difficult to train. We present a residual learning "
            "framework to ease the training of networks that are substantially deeper than those "
            "used previously, reformulating layers as learning residual functions with reference "
            "to the layer inputs."
        ),
    },
    {
        "doi": "10.18653/v1/N19-1423",
        "arxiv_id": "1810.04805",
        "title": "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        "authors": ["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"],
        "year": "2019",
        "venue": "Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies",
        "abstract": (
            "We introduce a new language representation model called BERT, which stands for "
            "Bidirectional Encoder Representations from Transformers. BERT is designed to pre-train "
            "deep bidirectional representations from unlabeled text by jointly conditioning on both "
            "left and right context in all layers."
        ),
    },
    {
        "doi": "10.48550/arXiv.2005.14165",
        "arxiv_id": "2005.14165",
        "title": "Language Models are Few-Shot Learners",
        "authors": [
            "Tom B. Brown",
            "Benjamin Mann",
            "Nick Ryder",
            "Melanie Subbiah",
            "Jared Kaplan",
            "Prafulla Dhariwal",
            "Arvind Neelakantan",
        ],
        "year": "2020",
        "venue": "Advances in Neural Information Processing Systems",
        "abstract": (
            "Recent work has demonstrated substantial gains on many NLP tasks and benchmarks by "
            "pre-training on a large corpus of text followed by fine-tuning on a specific task. "
            "Here we show that scaling up language models greatly improves task-agnostic, "
            "few-shot performance, training GPT-3 with 175 billion parameters."
        ),
    },
    {
        "doi": "10.1038/nature14539",
        "title": "Deep learning",
        "authors": ["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
        "year": "2015",
        "venue": "Nature",
        "abstract": (
            "Deep learning allows computational models that are composed of multiple processing "
            "layers to learn representations of data with multiple levels of abstraction."
        ),
    },
    {
        "doi": "10.18653/v1/D19-1410",
        "title": "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks",
        "authors": ["Nils Reimers", "Iryna Gurevych"],
        "year": "2019",
        "venue": "Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing (EMNLP)",
        "abstract": (
            "BERT and RoBERTa have set a new state-of-the-art performance on sentence-pair "
            "regression tasks like semantic textual similarity. In this publication, we present "
            "Sentence-BERT (SBERT), a modification of the pretrained BERT network that uses "
            "siamese and triplet network structures to derive semantically meaningful sentence "
            "embeddings that can be compared using cosine-similarity."
        ),
    },
    {
        "doi": "10.18653/v1/P16-1162",
        "title": "Neural Machine Translation of Rare Words with Subword Units",
        "authors": ["Rico Sennrich", "Barry Haddow", "Alexandra Birch"],
        "year": "2016",
        "venue": "Proceedings of the 54th Annual Meeting of the Association for Computational Linguistics",
        "abstract": (
            "Neural machine translation models typically operate with a fixed vocabulary, "
            "but translation is an open-vocabulary problem. We introduce a simpler and more "
            "effective approach, encoding rare and unknown words as sequences of subword units "
            "based on Byte Pair Encoding."
        ),
    },
    {
        "doi": "10.18653/v1/P18-1031",
        "title": "Universal Language Model Fine-tuning for Text Classification",
        "authors": ["Jeremy Howard", "Sebastian Ruder"],
        "year": "2018",
        "venue": "Proceedings of the 56th Annual Meeting of the Association for Computational Linguistics",
        "abstract": (
            "Inductive transfer learning has greatly impacted computer vision, but existing "
            "approaches in NLP still require task-specific modifications and training from scratch. "
            "We propose Universal Language Model Fine-tuning (ULMFiT), an effective transfer "
            "learning method that can be applied to any task in NLP."
        ),
    },
    {
        "doi": "10.1145/3442188.3445922",
        "title": "On the Dangers of Stochastic Parrots: Can Language Models Be Too Big?",
        "authors": [
            "Emily M. Bender",
            "Timnit Gebru",
            "Angelina McMillan-Major",
            "Shmargaret Shmitchell",
        ],
        "year": "2021",
        "venue": "Proceedings of the 2021 ACM Conference on Fairness, Accountability, and Transparency",
        "abstract": (
            "The past three years of work in NLP have been characterized by the development and "
            "deployment of ever larger language models. Weweigh the environmental and financial "
            "costs alongside risks of documentation debt and unfathomable training data."
        ),
    },
    {
        "doi": "10.3115/1073083.1073135",
        "title": "Bleu: a Method for Automatic Evaluation of Machine Translation",
        "authors": ["Kishore Papineni", "Salim Roukos", "Todd Ward", "Wei-Jing Zhu"],
        "year": "2002",
        "venue": "Proceedings of the 40th Annual Meeting of the Association for Computational Linguistics",
        "abstract": (
            "Human evaluations of machine translation are extensive but expensive. We propose "
            "a method of automatic machine translation evaluation based on modified n-gram precision "
            "that is quick, inexpensive, and language-independent, correlating highly with human evaluation."
        ),
    },
    {
        "doi": "10.18653/v1/D16-1244",
        "title": "A Decomposable Attention Model for Natural Language Inference",
        "authors": ["Ankur P. Parikh", "Oscar Tackstrom", "Dipanjan Das", "Jakob Uszkoreit"],
        "year": "2016",
        "venue": "Proceedings of the 2016 Conference on Empirical Methods in Natural Language Processing",
        "abstract": (
            "We propose a simple neural architecture for natural language inference using attention "
            "to decompose the problem into subproblems that can be solved separately and trivially "
            "parallelized."
        ),
    },
    # --- Domain 2: Biomedical & Clinical ---
    {
        "doi": "10.1136/bmj.n71",
        "title": "The PRISMA 2020 statement: an updated guideline for reporting systematic reviews",
        "authors": [
            "Matthew J. Page",
            "Joanne E. McKenzie",
            "Patrick M. Bossuyt",
            "Isabelle Boutron",
            "Tammy C. Hoffmann",
            "Cynthia D. Mulrow",
        ],
        "year": "2021",
        "venue": "BMJ",
        "abstract": (
            "The Preferred Reporting Items for Systematic reviews and Meta-Analyses (PRISMA) "
            "statement, published in 2009, was designed to help systematic reviewers transparently "
            "report why the review was done, what the authors did, and what they found. PRISMA 2020 "
            "includes a 27-item checklist and revised flow diagrams."
        ),
    },
    {
        "doi": "10.1056/NEJMoa2034577",
        "title": "Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine",
        "authors": [
            "Fernando P. Polack",
            "Stephen J. Thomas",
            "Nicholas Kitchin",
            "Judith Absalon",
            "Alejandra Gurtman",
            "Stephen Lockhart",
        ],
        "year": "2020",
        "venue": "New England Journal of Medicine",
        "abstract": (
            "In an ongoing multinational, placebo-controlled, observer-blinded, pivotal efficacy "
            "trial, we randomly assigned persons 16 years of age or older to receive two doses "
            "of BNT162b2 vaccine or placebo; a two-dose regimen conferred 95% protection against Covid-19."
        ),
    },
    {
        "doi": "10.1038/s41586-021-03819-2",
        "title": "Highly accurate protein structure prediction with AlphaFold",
        "authors": [
            "John Jumper",
            "Richard Evans",
            "Alexander Pritzel",
            "Tim Green",
            "Michael Figurnov",
            "Olaf Ronneberger",
            "Demis Hassabis",
        ],
        "year": "2021",
        "venue": "Nature",
        "abstract": (
            "Proteins are essential to life, and understanding their structure can facilitate a "
            "mechanistic understanding of their function. Here we provide the first computational "
            "method AlphaFold that can regularly predict protein structures with atomic accuracy."
        ),
    },
    {
        "doi": "10.1126/science.1225829",
        "title": "A Programmable Dual-RNA-Guided DNA Endonuclease in Adaptive Bacterial Immunity",
        "authors": [
            "Martin Jinek",
            "Krzysztof Chylinski",
            "Ines Fonfara",
            "Michael Hauer",
            "Jennifer A. Doudna",
            "Emmanuelle Charpentier",
        ],
        "year": "2012",
        "venue": "Science",
        "abstract": (
            "Clustered regularly interspaced short palindromic repeats (CRISPR)/CRISPR-associated "
            "(Cas) systems provide bacteria and archaea with adaptive immunity against viruses "
            "and plasmids by using CRISPR RNAs to guide the silencing of invading nucleic acids."
        ),
    },
    {
        "doi": "10.1056/NEJMoa2021436",
        "title": "Dexamethasone in Hospitalized Patients with Covid-19",
        "authors": [
            "Peter Horby",
            "Wei Shen Lim",
            "Jonathan R. Emberson",
            "Marion Mafham",
            "Jennifer L. Bell",
            "Louise Linsell",
            "Martin J. Landray",
        ],
        "year": "2021",
        "venue": "New England Journal of Medicine",
        "abstract": (
            "In hospitalized patients with Covid-19, the use of oral or intravenous dexamethasone "
            "for up to 10 days resulted in lower 28-day mortality among those who were receiving "
            "either invasive mechanical ventilation or oxygen alone."
        ),
    },
    {
        "doi": "10.1136/bmj.c332",
        "title": "CONSORT 2010 Statement: updated guidelines for reporting parallel group randomised trials",
        "authors": ["Kenneth F. Schulz", "Douglas G. Altman", "David Moher"],
        "year": "2010",
        "venue": "BMJ",
        "abstract": (
            "The CONSORT 2010 statement provides updated guidelines and a 25-item checklist "
            "for transparent reporting of two-group parallel design randomized controlled trials."
        ),
    },
    {
        "doi": "10.1038/s41591-018-0300-7",
        "title": "High-performance medicine: the convergence of human and artificial intelligence",
        "authors": ["Eric J. Topol"],
        "year": "2019",
        "venue": "Nature Medicine",
        "abstract": (
            "The convergence of artificial intelligence and deep neural networks with clinical "
            "medicine promises improved diagnostic accuracy across radiology, pathology, dermatology, "
            "ophthalmology, and cardiology."
        ),
    },
    {
        "doi": "10.1016/S0140-6736(20)31180-6",
        "title": "Hydroxychloroquine or chloroquine with or without a macrolide for treatment of COVID-19: a multinational registry analysis",
        "authors": [
            "Mandeep R. Mehra",
            "Sapan S. Desai",
            "Frank Ruschitzka",
            "Amit N. Patel",
        ],
        "year": "2020",
        "venue": "The Lancet",
        "is_retracted": True,
        "abstract": (
            "Observational multinational registry analysis of hydroxychloroquine or chloroquine "
            "in hospitalized COVID-19 patients (subsequently retracted after independent audit "
            "could not verify primary Surgisphere hospital dataset)."
        ),
    },
    # --- Domain 3: Economics, Finance & Social Sciences ---
    {
        "doi": "10.2307/1914185",
        "title": "Prospect Theory: An Analysis of Decision under Risk",
        "authors": ["Daniel Kahneman", "Amos Tversky"],
        "year": "1979",
        "venue": "Econometrica",
        "abstract": (
            "This paper presents a critique of expected utility theory as a descriptive model "
            "of decision making under risk, and develops an alternative model, called prospect "
            "theory, in which value is assigned to gains and losses rather than to final assets."
        ),
    },
    {
        "doi": "10.1257/aer.91.5.1369",
        "title": "The Colonial Origins of Comparative Development: An Empirical Investigation",
        "authors": ["Daron Acemoglu", "Simon Johnson", "James A. Robinson"],
        "year": "2001",
        "venue": "American Economic Review",
        "abstract": (
            "We exploit differences in European settler mortality rates across former colonies "
            "as an instrument for current institutions to estimate the causal effect of "
            "institutions on economic performance and per capita income."
        ),
    },
    {
        "doi": "10.1257/aer.103.6.2121",
        "title": "The China Syndrome: Local Labor Market Effects of Import Competition in the United States",
        "authors": ["David H. Autor", "David Dorn", "Gordon H. Hanson"],
        "year": "2013",
        "venue": "American Economic Review",
        "abstract": (
            "We analyze the effect of rising Chinese import competition between 1990 and 2007 "
            "on US local labor markets, finding that rising imports cause higher unemployment, "
            "lower labor force participation, and reduced wages in import-competing manufacturing."
        ),
    },
    {
        "doi": "10.1093/qje/qju022",
        "title": "Where is the land of opportunity? The geography of intergenerational mobility in the United States",
        "authors": ["Raj Chetty", "Nathaniel Hendren", "Patrick Kline", "Emmanuel Saez"],
        "year": "2014",
        "venue": "The Quarterly Journal of Economics",
        "abstract": (
            "We use administrative tax records of more than 40 million children and their parents "
            "to characterize intergenerational income mobility across commuting zones in the United States."
        ),
    },
    {
        "doi": "10.1257/aer.91.4.795",
        "title": "Schooling and Labor Market Consequences of School Construction in Indonesia: Evidence from an Unusual Policy Experiment",
        "authors": ["Esther Duflo"],
        "year": "2001",
        "venue": "American Economic Review",
        "abstract": (
            "Between 1973 and 1978, the Indonesian government constructed over 61,000 primary "
            "schools under the Sekolah Dasar INPRES program, enabling difference-in-differences "
            "and instrumental-variables estimation of economic returns to education."
        ),
    },
    {
        "doi": "10.2307/2951620",
        "title": "Identification and Estimation of Local Average Treatment Effects",
        "authors": ["Joshua D. Angrist", "Guido W. Imbens"],
        "year": "1994",
        "venue": "Econometrica",
        "abstract": (
            "We investigate conditions under which instrumental variables estimators identify "
            "the local average treatment effect (LATE) for compliers under monotonicity."
        ),
    },
    {
        "doi": "10.1016/j.jfineco.2014.10.010",
        "title": "A five-factor asset pricing model",
        "authors": ["Eugene F. Fama", "Kenneth R. French"],
        "year": "2015",
        "venue": "Journal of Financial Economics",
        "abstract": (
            "A five-factor model directed at capturing the size, value, profitability, and "
            "investment patterns in average stock returns performs better than the three-factor "
            "Fama-French model."
        ),
    },
    {
        "doi": "10.1016/0304-405X(93)90023-5",
        "title": "Common risk factors in the returns on stocks and bonds",
        "authors": ["Eugene F. Fama", "Kenneth R. French"],
        "year": "1993",
        "venue": "Journal of Financial Economics",
        "abstract": (
            "This paper identifies five common risk factors in the returns on stocks and bonds, "
            "including overall market, firm size, book-to-market equity, maturity, and default risk."
        ),
    },
    # --- Domain 4: Engineering & Physics ---
    {
        "doi": "10.1016/j.jcp.2018.10.045",
        "title": "Physics-informed neural networks: A deep learning framework for solving forward and inverse problems involving nonlinear partial differential equations",
        "authors": ["Maziar Raissi", "Paris Perdikaris", "George Em Karniadakis"],
        "year": "2019",
        "venue": "Journal of Computational Physics",
        "abstract": (
            "We introduce physics-informed neural networks — neural networks that are trained "
            "to solve supervised learning tasks while respecting any given laws of physics "
            "described by general nonlinear partial differential equations."
        ),
    },
    {
        "doi": "10.1126/science.1102896",
        "title": "Electric Field Effect in Atomically Thin Carbon Films",
        "authors": [
            "Kostya S. Novoselov",
            "Andre K. Geim",
            "Sergei V. Morozov",
            "Dingde Jiang",
            "Yuanbo Zhang",
            "Sergey V. Dubonos",
            "Irina V. Grigorieva",
            "Alexandr A. Firsov",
        ],
        "year": "2004",
        "venue": "Science",
        "abstract": (
            "We describe monocrystalline graphitic films, which are a few atoms thick and "
            "nonetheless stable under ambient conditions, metallic, and of remarkably high "
            "electronic quality, exhibiting a pronounced ambipolar electric field effect."
        ),
    },
    {
        "doi": "10.1103/PhysRevLett.116.061102",
        "title": "Observation of Gravitational Waves from a Binary Black Hole Merger",
        "authors": [
            "B. P. Abbott",
            "R. Abbott",
            "T. D. Abbott",
            "M. R. Abernathy",
            "F. Acernese",
            "K. Ackley",
        ],
        "year": "2016",
        "venue": "Physical Review Letters",
        "abstract": (
            "On September 14, 2015 at 09:50:45 UTC the two detectors of the Laser Interferometer "
            "Gravitational-Wave Observatory simultaneously observed a transient gravitational-wave "
            "signal GW150914 from the inspiral and merger of a pair of black holes."
        ),
    },
    {
        "doi": "10.1063/1.1736034",
        "title": "Detailed Balance Limit of Efficiency of p-n Junction Solar Cells",
        "authors": ["William Shockley", "Hans J. Queisser"],
        "year": "1961",
        "venue": "Journal of Applied Physics",
        "abstract": (
            "In order to find an upper theoretical limit for the efficiency of p-n junction "
            "solar energy converters, a limiting efficiency, called the detailed balance limit, "
            "has been calculated for an ideal Shockley-Queisser photovoltaic junction."
        ),
    },
    {
        "doi": "10.1002/j.1538-7305.1948.tb01338.x",
        "title": "A Mathematical Theory of Communication",
        "authors": ["Claude E. Shannon"],
        "year": "1948",
        "venue": "Bell System Technical Journal",
        "abstract": (
            "The fundamental problem of communication is that of reproducing at one point "
            "either exactly or approximately a message selected at another point, establishing "
            "entropy and channel capacity theorems."
        ),
    },
    {
        "doi": "10.1115/1.3662552",
        "title": "A New Approach to Linear Filtering and Prediction Problems",
        "authors": ["Rudolf E. Kalman"],
        "year": "1960",
        "venue": "Journal of Basic Engineering",
        "abstract": (
            "A new state-space recursive approach to linear filtering and prediction problems "
            "is developed using orthogonal projections, generalizing Wiener filtering."
        ),
    },
    {
        "doi": "10.1038/s41586-020-2801-z",
        "title": "Room-temperature superconductivity in a carbonaceous sulfur hydride",
        "authors": [
            "Elliot Snider",
            "Nathan Dasenbrock-Gammon",
            "Raymond McBride",
            "Mathew Debessai",
            "Hiranya Vindana",
            "Kevin Vencatasamy",
            "Keith V. Lawler",
            "Ashkan Salamat",
            "Ranga P. Dias",
        ],
        "year": "2020",
        "venue": "Nature",
        "is_retracted": True,
        "abstract": (
            "Report of room-temperature superconductivity in photochemically transformed "
            "carbonaceous sulfur hydride under high pressure (subsequently retracted by Nature "
            "due to background subtraction data integrity concerns)."
        ),
    },
)

OFFLINE_RFC_CATALOG: dict[int, dict[str, Any]] = {
    9110: {
        "title": "HTTP Semantics",
        "authors": ["R. Fielding", "M. Nottingham", "J. Reschke"],
        "year": "2022",
        "doi": "10.17487/RFC9110",
        "venue": "IETF Internet Standard (RFC 9110)",
    },
    8446: {
        "title": "The Transport Layer Security (TLS) Protocol Version 1.3",
        "authors": ["E. Rescorla"],
        "year": "2018",
        "doi": "10.17487/RFC8446",
        "venue": "IETF Proposed Standard (RFC 8446)",
    },
    6749: {
        "title": "The OAuth 2.0 Authorization Framework",
        "authors": ["D. Hardt"],
        "year": "2012",
        "doi": "10.17487/RFC6749",
        "venue": "IETF Proposed Standard (RFC 6749)",
    },
}

OFFLINE_PYPI_CATALOG: dict[str, dict[str, Any]] = {
    "fastapi": {
        "title": "FastAPI framework, high performance, easy to learn, fast to code, ready for production",
        "authors": ["Sebastián Ramírez"],
        "year": "2024",
        "venue": "Python Package Index (PyPI)",
        "url": "https://pypi.org/project/fastapi/",
    },
    "scikit-learn": {
        "title": "scikit-learn: machine learning in Python",
        "authors": ["Fabian Pedregosa", "Gael Varoquaux", "Alexandre Gramfort"],
        "year": "2024",
        "venue": "Python Package Index (PyPI)",
        "url": "https://pypi.org/project/scikit-learn/",
    },
}

OFFLINE_GITHUB_CATALOG: dict[str, dict[str, Any]] = {
    "huggingface/transformers": {
        "title": "Transformers: State-of-the-art Machine Learning for Pytorch, TensorFlow, and JAX",
        "authors": ["Thomas Wolf", "Lysandre Debut", "Victor Sanh", "Julien Chaumond"],
        "year": "2020",
        "venue": "GitHub Repository (huggingface/transformers)",
        "url": "https://github.com/huggingface/transformers",
    },
    "pytorch/pytorch": {
        "title": "PyTorch: Tensors and Dynamic neural networks in Python with strong GPU acceleration",
        "authors": ["Adam Paszke", "Sam Gross", "Soumith Chintala"],
        "year": "2019",
        "venue": "GitHub Repository (pytorch/pytorch)",
        "url": "https://github.com/pytorch/pytorch",
    },
}

OFFLINE_HF_CATALOG: dict[str, dict[str, Any]] = {
    "vinai/phobert-base": {
        "title": "vinai/phobert-base: Pre-trained language models for Vietnamese",
        "authors": ["Dat Quoc Nguyen", "Anh Tuan Nguyen"],
        "year": "2020",
        "venue": "Hugging Face Hub",
        "url": "https://huggingface.co/vinai/phobert-base",
    },
}

# Regional non-Crossref DOI Registration Agencies whose DOIs are registered in the global
# Handle system without public Crossref CSL-JSON metadata.
OFFLINE_REGIONAL_NO_CSL_PREFIXES: dict[str, str] = {
    "10.11501/": "JaLC",
    "10.13334/": "CNKI",
    "10.9728/": "KISTI",
    "10.19282/": "mEDRA",
    "10.3969/": "ISTIC",
}


class _ReadOnlyLocalDatabase:
    """Fast, strictly read-only SQLite adapter over `LocalDatabase` (`?mode=ro` URI).

    Queries the real `data/local_papers.db` knowledge base using a single persistent
    read-only connection (<5ms for 120 lookups) without creating WAL/SHM sidecars or
    mutating `local_papers.db`.
    """

    _VN_STD_PREFIX_RE = re.compile(r"\b(?:TCVN|QCVN)\s+[A-ZĐ0-9]", re.IGNORECASE)

    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(
            f"file:{self.db_path.resolve()}?mode=ro",
            uri=True,
            check_same_thread=False,
            timeout=5.0,
        )
        self._conn.row_factory = sqlite3.Row

    def find_by_doi(self, doi: str | None) -> Paper | None:
        nd = normalize_doi(doi) if doi else None
        if not nd:
            return None
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM papers WHERE doi = ? LIMIT 1",
                (nd,),
            ).fetchone()
        if row is None:
            return None
        paper = Paper.from_dict(dict(row))
        if self._VN_STD_PREFIX_RE.search(str(paper.title or "")):
            return None
        return paper

    def find_by_arxiv_id(self, arxiv_id: str | None) -> Paper | None:
        na = normalize_arxiv_id(arxiv_id) if arxiv_id else None
        if not na:
            return None
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM papers WHERE arxiv_id = ? LIMIT 1",
                (na,),
            ).fetchone()
        return Paper.from_dict(dict(row)) if row is not None else None

    def fuzzy_search(self, **kwargs: Any) -> list[Paper]:  # noqa: ARG002
        return []

    def add_paper(self, paper: Any) -> int | None:  # noqa: ARG002
        return None

    def log_query(self, *args: Any, **kwargs: Any) -> None:
        return None

    @contextlib.contextmanager
    def _get_conn(self) -> Any:
        # Read-only no-op context manager so abstract enrichment never mutates local_papers.db
        conn = sqlite3.connect(":memory:")
        try:
            yield conn
        finally:
            conn.close()


def _record_to_candidate(record: dict[str, Any], source_name: str, *, confidence: float = 0.96) -> SourceCandidate:
    ext_ids: dict[str, str] = {}
    if record.get("arxiv_id"):
        ext_ids["arxiv"] = str(record["arxiv_id"])
    if record.get("is_retracted"):
        ext_ids["is_retracted"] = "true"
    return SourceCandidate(
        source_name=source_name,
        found=True,
        doi=record.get("doi"),
        title=record.get("title"),
        authors=list(record.get("authors") or []),
        year=str(record["year"]) if record.get("year") else None,
        venue=record.get("venue"),
        abstract=record.get("abstract"),
        external_ids=ext_ids,
        score=1.0,
        confidence=confidence,
    )


class _OfflineScholarlyClient(BaseScholarClient):
    """Deterministic offline scholarly client backed strictly by `OFFLINE_CANONICAL_SCHOLARLY_CATALOG`."""

    def __init__(self, name: str, *, supports_doi: bool = True) -> None:
        super().__init__(timeout=2.0)
        self.name = name
        self._supports_doi = supports_doi
        self._by_doi: dict[str, dict[str, Any]] = {}
        self._by_arxiv: dict[str, dict[str, Any]] = {}
        for rec in OFFLINE_CANONICAL_SCHOLARLY_CATALOG:
            if rec.get("doi"):
                nd = normalize_doi(str(rec["doi"]))
                if nd:
                    self._by_doi[nd] = rec
            if rec.get("arxiv_id"):
                na = normalize_arxiv_id(str(rec["arxiv_id"]))
                if na:
                    self._by_arxiv[na] = rec

    async def lookup(self, citation: Citation) -> SourceCandidate:
        self._reset_http_telemetry()
        self._last_status_code = 200

        # 1. Exact DOI lookup (mirrors CrossrefClient / OpenAlexClient behavior)
        if self._supports_doi and citation.doi:
            nd = normalize_doi(citation.doi)
            if nd and nd in self._by_doi:
                return _record_to_candidate(self._by_doi[nd], self.name, confidence=1.0)
            for rfc_rec in OFFLINE_RFC_CATALOG.values():
                if nd and normalize_doi(rfc_rec.get("doi")) == nd:
                    return _record_to_candidate(rfc_rec, self.name, confidence=1.0)

        # 2. Exact arXiv ID lookup
        ax_id = ArxivClient.extract_arxiv_id(citation)
        norm_ax = normalize_arxiv_id(ax_id) if ax_id else None
        if norm_ax and norm_ax in self._by_arxiv:
            return _record_to_candidate(self._by_arxiv[norm_ax], self.name, confidence=0.98)

        # 3. Bibliographic title search fallback
        query_title = (citation.title or "").strip()
        if query_title and len(query_title) >= 6:
            best_rec: dict[str, Any] | None = None
            best_sim = 0.0
            for rec in OFFLINE_CANONICAL_SCHOLARLY_CATALOG:
                rec_title = str(rec.get("title") or "")
                sim = title_similarity(query_title, rec_title)
                if sim > best_sim:
                    best_sim = sim
                    best_rec = rec
                elif (
                    sim == best_sim
                    and best_rec is not None
                    and citation.authors
                    and author_match_score(citation.authors, list(rec.get("authors") or []))
                    > author_match_score(citation.authors, list(best_rec.get("authors") or []))
                ):
                    best_rec = rec
            if best_rec is not None and best_sim >= 0.68:
                return _record_to_candidate(best_rec, self.name, confidence=round(best_sim, 3))

        return SourceCandidate(
            source_name=self.name,
            found=False,
            error=f"{self.name}: No results for query '{(citation.title or citation.raw_text)[:60]}'",
        )


class _OfflineDoiRaClient(DoiRaClient):
    """Deterministic offline DOI Registration Agency client."""

    def __init__(self) -> None:
        super().__init__(timeout=2.0)
        self._by_doi: dict[str, dict[str, Any]] = {}
        for rec in OFFLINE_CANONICAL_SCHOLARLY_CATALOG:
            if rec.get("doi"):
                nd = normalize_doi(str(rec["doi"]))
                if nd:
                    self._by_doi[nd] = rec
        for rfc_rec in OFFLINE_RFC_CATALOG.values():
            if rfc_rec.get("doi"):
                nd = normalize_doi(str(rfc_rec["doi"]))
                if nd:
                    self._by_doi[nd] = rfc_rec

    async def lookup(self, citation: Citation) -> SourceCandidate:
        self._reset_http_telemetry()
        self._last_status_code = 200
        nd = normalize_doi(citation.doi) if citation.doi else None
        if not nd:
            return SourceCandidate(source_name=self.name, found=False, error="No DOI provided")
        if nd in self._by_doi:
            cand = _record_to_candidate(self._by_doi[nd], self.name, confidence=0.98)
            cand.external_ids = {**(cand.external_ids or {}), "doi_ra": "Crossref"}
            return cand
        for prefix, ra_name in OFFLINE_REGIONAL_NO_CSL_PREFIXES.items():
            if nd.lower().startswith(prefix.lower()):
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"DOI '{nd}' registered (RA={ra_name}) but CSL metadata unavailable",
                    external_ids={
                        "doi_ra": ra_name,
                        "doi_ra_status": "registered_no_csl",
                    },
                )
        return SourceCandidate(
            source_name=self.name,
            found=False,
            error=f"DOI '{nd}' does not exist in Handle registry",
            external_ids={"doi_ra_status": "nonexistent"},
        )


class _OfflineTechStandardClient(TechStandardClient):
    """Offline `TechStandardClient` preserving real `TCVN`/`QCVN` & VN textbook registries."""

    def __init__(self) -> None:
        super().__init__(timeout=2.0)

    async def _lookup_rfc(
        self,
        rfc_num: int,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        rec = OFFLINE_RFC_CATALOG.get(rfc_num)
        if rec is None:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"RFC {rfc_num} not found (404)",
            )
        title = str(rec["title"])
        if (
            citation
            and citation.title
            and re.search(rf"\bRFC\s*[-#:]?\s*{rfc_num}\b", citation.title, re.IGNORECASE)
            and not re.search(rf"\bRFC\s*[-#:]?\s*{rfc_num}\b", title, re.IGNORECASE)
        ):
            title = f"RFC {rfc_num}: {title}"
        return SourceCandidate(
            source_name=self.name,
            found=True,
            doi=rec.get("doi"),
            title=title,
            authors=list(rec.get("authors") or ["IETF"]),
            year=str(rec["year"]),
            venue=str(rec.get("venue") or f"IETF RFC {rfc_num}"),
            external_ids={"rfc": str(rfc_num)},
            confidence=0.98,
        )

    async def _lookup_pypi(
        self,
        pkg: str,
        citation: Citation | None = None,  # noqa: ARG002
    ) -> SourceCandidate | None:
        rec = OFFLINE_PYPI_CATALOG.get(pkg.lower())
        if rec is None:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"PyPI package '{pkg}' not found (404)",
                external_ids={"pypi_package": pkg, "pypi_status": "nonexistent"},
            )
        return SourceCandidate(
            source_name=self.name,
            found=True,
            title=f"{pkg}: {rec['title']}",
            authors=list(rec["authors"]),
            year=str(rec["year"]),
            venue=str(rec["venue"]),
            url=str(rec["url"]),
            external_ids={"pypi_package": pkg},
            confidence=0.96,
        )

    async def _lookup_npm(
        self,
        pkg: str,
        citation: Citation | None = None,  # noqa: ARG002
    ) -> SourceCandidate | None:
        return SourceCandidate(
            source_name=self.name,
            found=False,
            error=f"NPM package '{pkg}' not found (404)",
            external_ids={"npm_package": pkg, "npm_status": "nonexistent"},
        )

    async def _lookup_github_repo(
        self,
        slug: str,
        citation: Citation | None = None,  # noqa: ARG002
    ) -> SourceCandidate | None:
        rec = OFFLINE_GITHUB_CATALOG.get(slug.lower())
        if rec is None:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"GitHub repository '{slug}' not found (404)",
                external_ids={"github_repo": slug, "github_status": "nonexistent"},
            )
        return SourceCandidate(
            source_name=self.name,
            found=True,
            title=str(rec["title"]),
            authors=list(rec["authors"]),
            year=str(rec["year"]),
            venue=str(rec["venue"]),
            url=str(rec["url"]),
            external_ids={"github_repo": slug},
            confidence=0.96,
        )


class _OfflineHuggingFaceClient(HuggingFaceClient):
    """Deterministic offline Hugging Face Hub client."""

    def __init__(self) -> None:
        super().__init__(timeout=2.0)

    async def lookup(self, citation: Citation) -> SourceCandidate:
        self._reset_http_telemetry()
        self._last_status_code = 200
        _, repo_id = self.extract_hf_target(citation)
        if repo_id and repo_id.lower() in OFFLINE_HF_CATALOG:
            rec = OFFLINE_HF_CATALOG[repo_id.lower()]
            return SourceCandidate(
                source_name=self.name,
                found=True,
                title=str(rec["title"]),
                authors=list(rec["authors"]),
                year=str(rec["year"]),
                venue=str(rec["venue"]),
                url=str(rec["url"]),
                confidence=0.95,
            )
        return SourceCandidate(
            source_name=self.name,
            found=False,
            error=f"HuggingFace: No results for '{repo_id or citation.raw_text[:40]}'",
        )


class _OfflineWikidataClient(WikidataOpenCitationsClient):
    """Deterministic offline Wikidata/OpenCitations client."""

    def __init__(self) -> None:
        super().__init__(timeout=2.0)

    async def lookup(self, citation: Citation) -> SourceCandidate:
        self._reset_http_telemetry()
        self._last_status_code = 200
        return SourceCandidate(
            source_name=self.name,
            found=False,
            error=f"Wikidata: No results for '{(citation.title or citation.raw_text)[:40]}'",
        )


class _OfflineLinkValidator:
    """Deterministic offline URL validator (zero network calls)."""

    async def validate_url(self, url: str) -> LinkCheckResult:
        return await self.check_url(url)

    async def check_url(self, url: str) -> LinkCheckResult:
        cleaned = clean_extracted_url(url)
        if not cleaned:
            return LinkCheckResult(url="", status=LinkStatus.UNCHECKED)

        is_fake, fake_dom = _is_fake_url(cleaned)
        if is_fake:
            return LinkCheckResult(
                url=cleaned,
                status=LinkStatus.FAKE_DOMAIN,
                error=f"Fake/reserved domain: {fake_dom}",
            )

        low = cleaned.lower()
        gh_m = re.search(r"github\.com/([a-z0-9_.-]+/[a-z0-9_.-]+)", low)
        if gh_m:
            slug = gh_m.group(1).rstrip("/")
            if slug in OFFLINE_GITHUB_CATALOG:
                return LinkCheckResult(url=cleaned, status=LinkStatus.ALIVE, status_code=200)
            return LinkCheckResult(url=cleaned, status=LinkStatus.DEAD_LINK, status_code=404)

        pypi_m = re.search(r"pypi\.org/project/([a-z0-9_.-]+)", low)
        if pypi_m:
            pkg = pypi_m.group(1).rstrip("/")
            if pkg in OFFLINE_PYPI_CATALOG:
                return LinkCheckResult(url=cleaned, status=LinkStatus.ALIVE, status_code=200)
            return LinkCheckResult(url=cleaned, status=LinkStatus.DEAD_LINK, status_code=404)

        hf_m = re.search(r"huggingface\.co/([a-z0-9_.-]+/[a-z0-9_.-]+)", low)
        if hf_m:
            repo = hf_m.group(1).rstrip("/")
            if repo in OFFLINE_HF_CATALOG:
                return LinkCheckResult(url=cleaned, status=LinkStatus.ALIVE, status_code=200)
            return LinkCheckResult(url=cleaned, status=LinkStatus.DEAD_LINK, status_code=404)

        if any(tok in low for tok in ("/404", "nonexistent", "dead-link", "missing-page")):
            return LinkCheckResult(url=cleaned, status=LinkStatus.DEAD_LINK, status_code=404)

        return LinkCheckResult(url=cleaned, status=LinkStatus.ALIVE, status_code=200)


def build_offline_orchestrator(
    *,
    use_local_db: bool = True,
    local_db: LocalDatabase | None = None,
) -> RetrievalOrchestrator:
    """Build a real `RetrievalOrchestrator` wired with deterministic offline clients."""
    ro_local_db: Any = local_db
    if ro_local_db is None and use_local_db and DEFAULT_DB_PATH.is_file() and DEFAULT_DB_PATH.stat().st_size > 0:
        try:
            ro_local_db = _ReadOnlyLocalDatabase(DEFAULT_DB_PATH)
        except Exception:  # noqa: BLE001
            ro_local_db = None

    orchestrator = RetrievalOrchestrator(
        crossref=_OfflineScholarlyClient("crossref", supports_doi=True),
        openalex=_OfflineScholarlyClient("openalex", supports_doi=True),
        dblp=_OfflineScholarlyClient("dblp", supports_doi=False),
        arxiv=_OfflineScholarlyClient("arxiv", supports_doi=True),
        openlibrary=_OfflineScholarlyClient("openlibrary", supports_doi=False),
        europepmc=_OfflineScholarlyClient("europepmc", supports_doi=True),
        datacite=_OfflineScholarlyClient("datacite", supports_doi=True),
        doi_ra=_OfflineDoiRaClient(),
        doaj=_OfflineScholarlyClient("doaj", supports_doi=True),
        openaire_hal=_OfflineScholarlyClient("openaire_hal", supports_doi=True),
        ncbi_biorxiv=_OfflineScholarlyClient("ncbi_biorxiv", supports_doi=True),
        huggingface=_OfflineHuggingFaceClient(),
        tech_standard=_OfflineTechStandardClient(),
        wikidata_opencitations=_OfflineWikidataClient(),
        serpapi=None,
        parallel=True,
        local_db=ro_local_db,
        use_local_db=ro_local_db is not None,
        link_validator=_OfflineLinkValidator(),
        enable_link_validation=True,
        use_persistent_cache=False,
    )
    orchestrator._rate_limiters = {
        name: RateLimiter(10000.0) for name in orchestrator._rate_limiters
    }
    return orchestrator


# ============================================================================
# Dataset Loading & Multiclass Evaluation Metrics
# ============================================================================


def load_ground_truth(gt_path: Path | None = None) -> list[dict[str, Any]]:
    """Load ground-truth dataset from `end_to_end_gold_benchmark.json`, `adversarial_ground_truth.json`, or custom path."""
    candidates = (
        [gt_path]
        if gt_path is not None
        else [
            REPO_ROOT / "data" / "essays" / "end_to_end_gold_benchmark.json",
            REPO_ROOT / "data" / "essays" / "adversarial_ground_truth.json",
            REPO_ROOT / "evaluation" / "ground_truth.json",
        ]
    )
    resolved = next((p for p in candidates if p is not None and p.is_file()), None)
    if resolved is None:
        raise FileNotFoundError(
            f"Ground truth dataset not found. Checked: {[str(p) for p in candidates]}"
        )

    raw_payload = json.loads(resolved.read_text(encoding="utf-8"))
    raw_data = (
        raw_payload.get("items") or raw_payload.get("references") or []
        if isinstance(raw_payload, dict)
        else raw_payload
    )
    samples: list[dict[str, Any]] = []

    for entry_idx, entry in enumerate(raw_data):
        if isinstance(entry, dict) and "references" in entry:
            fname = str(entry.get("filename") or f"doc_{entry_idx}")
            for ref in entry.get("references") or []:
                ref_idx = ref.get("index", len(samples) + 1)
                raw_ref = str(ref.get("raw_reference") or "").strip()
                if not raw_ref:
                    continue
                samples.append(
                    {
                        "citation_id": f"{fname}#{ref_idx}",
                        "citation_formatted": raw_ref,
                        "citation_raw": str(ref.get("intext_marker") or raw_ref),
                        "style": str(ref.get("style") or "APA 7th"),
                        "domain": str(ref.get("domain") or "Mixed Adversarial"),
                        "error_subtype": str(ref.get("error_subtype") or ""),
                        "citation_context": ref.get("citation_context"),
                        "notes": str(ref.get("notes") or ""),
                        "ground_truth": _normalize_eval_label(
                            str(ref.get("expected_label") or "unresolved")
                        ),
                    }
                )
        elif isinstance(entry, dict):
            cid = str(
                entry.get("id")
                or entry.get("citation_id")
                or f"sample_{entry_idx + 1:03d}"
            )
            raw_fmt = str(
                entry.get("raw_reference")
                or entry.get("citation_formatted")
                or entry.get("citation_raw")
                or ""
            ).strip()
            if not raw_fmt:
                continue
            samples.append(
                {
                    "citation_id": cid,
                    "citation_formatted": raw_fmt,
                    "citation_raw": str(entry.get("citation_raw") or raw_fmt),
                    "style": str(entry.get("style") or "Unknown"),
                    "domain": str(entry.get("domain") or "General"),
                    "error_subtype": str(entry.get("error_subtype") or ""),
                    "citation_context": entry.get("citation_context"),
                    "notes": str(entry.get("notes") or ""),
                    "ground_truth": _normalize_eval_label(
                        str(entry.get("expected_label") or entry.get("ground_truth") or "unresolved")
                    ),
                }
            )
    return samples


def compute_label_metrics(
    y_true: list[str],
    y_pred: list[str],
    labels: tuple[str, ...] | list[str],
) -> dict[str, Any]:
    """Compute exact multi-class Precision, Recall, F1, Macro-F1, Accuracy, and Confusion Matrix."""
    if len(y_true) != len(y_pred):
        raise ValueError(f"Mismatched y_true ({len(y_true)}) vs y_pred ({len(y_pred)})")

    n = len(y_true)
    label_list = list(labels)
    all_observed = list(dict.fromkeys([*label_list, *y_true, *y_pred]))
    cm: dict[str, dict[str, int]] = {
        lbl: {p_lbl: 0 for p_lbl in all_observed} for lbl in label_list
    }
    support: Counter[str] = Counter(y_true)
    pred_counts: Counter[str] = Counter(y_pred)

    for t, p in zip(y_true, y_pred, strict=True):
        if t in cm:
            cm[t][p] = cm[t].get(p, 0) + 1

    per_class: dict[str, dict[str, Any]] = {}
    for lbl in label_list:
        tp = sum(1 for t, p in zip(y_true, y_pred, strict=True) if t == lbl and p == lbl)
        fp = sum(1 for t, p in zip(y_true, y_pred, strict=True) if t != lbl and p == lbl)
        fn = sum(1 for t, p in zip(y_true, y_pred, strict=True) if t == lbl and p != lbl)
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2.0 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
        per_class[lbl] = {
            "precision": round(prec, 6),
            "recall": round(rec, 6),
            "f1": round(f1, 6),
            "support": int(support.get(lbl, 0)),
            "predicted": int(pred_counts.get(lbl, 0)),
        }

    active_labels = [
        lbl for lbl in label_list if support.get(lbl, 0) > 0 or pred_counts.get(lbl, 0) > 0
    ] or label_list
    macro_prec = sum(per_class[lbl]["precision"] for lbl in active_labels) / len(active_labels)
    macro_rec = sum(per_class[lbl]["recall"] for lbl in active_labels) / len(active_labels)
    macro_f1 = sum(per_class[lbl]["f1"] for lbl in active_labels) / len(active_labels)
    correct = sum(1 for t, p in zip(y_true, y_pred, strict=True) if t == p)
    accuracy = (correct / n) if n > 0 else 0.0

    return {
        "precision": round(macro_prec, 6),
        "recall": round(macro_rec, 6),
        "f1": round(macro_f1, 6),
        "macro_f1": round(macro_f1, 6),
        "accuracy": round(accuracy, 6),
        "correct": correct,
        "num_samples": n,
        "active_labels": active_labels,
        "per_class": per_class,
        "support": {lbl: int(support.get(lbl, 0)) for lbl in label_list},
        "confusion_matrix": {
            lbl: {p_lbl: int(cm[lbl].get(p_lbl, 0)) for p_lbl in label_list}
            for lbl in label_list
        },
    }


def _compute_slice_breakdown(
    records: list[dict[str, Any]],
    slice_key: str,
) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for rec in records:
        key = str(rec.get(slice_key) or "Unknown")
        grouped.setdefault(key, []).append(rec)

    breakdown: dict[str, dict[str, Any]] = {}
    for key in sorted(grouped):
        items = grouped[key]
        yt = [it["ground_truth"] for it in items]
        yp = [it["predicted"] for it in items]
        m = compute_label_metrics(yt, yp, CANONICAL_5_LABELS)
        breakdown[key] = {
            "count": len(items),
            "correct": m["correct"],
            "accuracy": m["accuracy"],
            "macro_f1": m["macro_f1"],
        }
    return breakdown


async def evaluate_single_citation(
    citation: Citation,
    orchestrator: RetrievalOrchestrator,
    checker: NeuroSymbolicChecker,
    *,
    citation_context: str | None = None,
    precomputed_source: SourceResult | None = None,
    precomputed_features: Any = None,
) -> tuple[str, float, dict[str, Any]]:
    """Evaluate a single parsed `Citation` via `RetrievalOrchestrator` + `NeuroSymbolicChecker`.

    Preserves `ValidationLabel.RESOURCE` (`"resource"`) as its own canonical 5th class.
    """
    try:
        source_result = (
            precomputed_source
            if precomputed_source is not None
            else await orchestrator.retrieve(citation, allow_serpapi=False)
        )
        used_local_db = (
            source_result.sources_succeeded == ["local_db"]
            if source_result.sources_succeeded
            else False
        )
        verdict = checker.check(
            citation=citation,
            source=source_result,
            mapping_status=None,
            style_profile=None,
            citation_context=citation_context,
            api_exhausted=bool(source_result.api_exhausted),
            used_local_db=used_local_db,
            precomputed_features=precomputed_features,
        )
        mapped_label = verdict.label.value
        metadata = {
            "confidence": round(float(verdict.confidence), 4),
            "triggered_rules": list(verdict.triggered_rules),
            "mismatched_fields": list(verdict.mismatched_fields),
            "sources_succeeded": list(source_result.sources_succeeded),
            "sources_failed": dict(source_result.sources_failed),
            "parsed_authors": [
                getattr(a, "raw", None) or str(a) for a in (citation.authors or [])
            ],
            "parsed_year": citation.year,
            "parsed_title": citation.title,
            "parsed_venue": citation.venue,
            "parsed_doi": citation.doi,
            "parsed_url": citation.url,
            "matched_pattern": citation.matched_pattern,
        }
        return mapped_label, float(verdict.confidence), metadata
    except Exception as exc:  # noqa: BLE001
        return "unresolved", 0.0, {"error": str(exc)}


def _save_evaluation_artifacts(
    output_dir: Path,
    predictions_payload: dict[str, Any],
    metrics_payload: dict[str, Any],
    errors: list[dict[str, Any]],
) -> tuple[Path, Path, Path]:
    """Persist evaluation JSON artifacts synchronously."""
    output_dir.mkdir(parents=True, exist_ok=True)
    pred_path = output_dir / "pipeline_predictions.json"
    metrics_path = output_dir / "pipeline_evaluation_results.json"
    error_path = output_dir / "pipeline_error_analysis.json"

    pred_path.write_text(
        json.dumps(predictions_payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    metrics_path.write_text(
        json.dumps(metrics_payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    error_path.write_text(json.dumps(errors, indent=2, ensure_ascii=False), encoding="utf-8")
    return pred_path, metrics_path, error_path


async def predict_raw_references(
    inputs: list[tuple[str, str | None]],
    *,
    mode: str = "offline",
    use_local_db: bool = True,
    orchestrator: RetrievalOrchestrator | None = None,
    checker: NeuroSymbolicChecker | None = None,
    ref_parser: ReferenceListParser | None = None,
) -> list[tuple[str, float, dict[str, Any]]]:
    """Pure blind prediction over `(raw_reference, citation_context)` pairs.

    Accepts ONLY raw bibliography strings and optional citation contexts — never
    receives ground-truth labels, guaranteeing zero label-oracle leakage.
    """
    if mode not in {"offline", "live"}:
        raise ValueError(f"Unsupported evaluation mode: {mode!r} (expected 'offline' or 'live')")

    if mode == "offline":
        _enable_local_hf_offline_if_cached()

    parser = ref_parser or ReferenceListParser()
    active_orchestrator = orchestrator or (
        build_offline_orchestrator(use_local_db=use_local_db)
        if mode == "offline"
        else RetrievalOrchestrator()
    )
    active_checker = checker or NeuroSymbolicChecker()

    parsed_citations: list[Citation] = []
    for raw_text, ctx in inputs:
        cit = parse_raw_bibliography(raw_text, ref_parser=parser)
        if ctx:
            cit.context = ctx
        parsed_citations.append(cit)

    sem = asyncio.Semaphore(16 if mode == "offline" else 6)

    async def _retrieve_one(cit: Citation) -> SourceResult:
        async with sem:
            return await active_orchestrator.retrieve(
                cit,
                allow_serpapi=(None if mode == "live" else False),
            )

    sources = await asyncio.gather(*(_retrieve_one(c) for c in parsed_citations))

    batch_triples = [
        (cit, src, ctx)
        for cit, src, (_, ctx) in zip(parsed_citations, sources, inputs, strict=True)
        if cit.matched_pattern != "vn_legal_document"
        and any(getattr(c, "found", False) for c in (src.candidates or []))
    ]
    if batch_triples and hasattr(active_checker, "prewarm_comparison_batch"):
        active_checker.prewarm_comparison_batch(batch_triples)

    results: list[tuple[str, float, dict[str, Any]]] = []
    for cit, src, (_, ctx) in zip(parsed_citations, sources, inputs, strict=True):
        pre_feat = (
            active_checker.compare_evidence(cit, src, ctx)
            if hasattr(active_checker, "compare_evidence")
            else None
        )
        pred_lbl, conf, meta = await evaluate_single_citation(
            cit,
            active_orchestrator,
            active_checker,
            citation_context=ctx,
            precomputed_source=src,
            precomputed_features=pre_feat,
        )
        results.append((pred_lbl, conf, meta))
    return results


async def run_evaluation(
    limit: int | None = None,
    dataset_path: Path | None = None,
    output_dir: Path | None = None,
    *,
    mode: str = "offline",
    use_local_db: bool = True,
) -> dict[str, Any]:
    """Run full end-to-end ground-truth evaluation across raw bibliography strings."""
    start_wall = time.perf_counter()
    print("=" * 78)
    print(f"END-TO-END RAW-REFERENCE GROUND TRUTH EVALUATION (mode={mode.upper()})")
    print("=" * 78)

    dataset = load_ground_truth(dataset_path)
    if limit:
        dataset = dataset[:limit]

    print(f"\nLoaded {len(dataset)} ground-truth raw bibliography entries")
    counts = Counter(item["ground_truth"] for item in dataset)
    for lbl in CANONICAL_5_LABELS:
        if counts.get(lbl, 0) > 0:
            print(f"   - {lbl:<25}: {counts[lbl]}")

    # Blind prediction: strip all ground-truth fields before calling predictor
    blind_inputs: list[tuple[str, str | None]] = [
        (
            str(item.get("citation_formatted") or item.get("citation_raw") or ""),
            item.get("citation_context"),
        )
        for item in dataset
    ]
    blind_outputs = await predict_raw_references(
        blind_inputs,
        mode=mode,
        use_local_db=use_local_db,
    )

    predictions: dict[str, str] = {}
    confidences: dict[str, float] = {}
    metadata: dict[str, dict[str, Any]] = {}
    ground_truth: dict[str, str] = {}
    y_true_5: list[str] = []
    y_pred_5: list[str] = []
    y_true_4: list[str] = []
    y_pred_4: list[str] = []
    cal_pairs: list[tuple[float, int]] = []
    slice_records: list[dict[str, Any]] = []

    for item, (pred_label, confidence, meta) in zip(dataset, blind_outputs, strict=True):
        cid = item["citation_id"]
        truth_label = item["ground_truth"]
        predictions[cid] = pred_label
        confidences[cid] = confidence
        metadata[cid] = meta
        ground_truth[cid] = truth_label
        y_true_5.append(truth_label)
        y_pred_5.append(pred_label)
        if truth_label != "resource":
            y_true_4.append(truth_label)
            y_pred_4.append(pred_label)
        cal_pairs.append((confidence, 1 if pred_label == truth_label else 0))
        slice_records.append(
            {
                "citation_id": cid,
                "style": item.get("style", "Unknown"),
                "domain": item.get("domain", "General"),
                "ground_truth": truth_label,
                "predicted": pred_label,
            }
        )

    elapsed_sec = time.perf_counter() - start_wall
    e2e_5class = compute_label_metrics(y_true_5, y_pred_5, CANONICAL_5_LABELS)
    scholarly_4class = compute_label_metrics(y_true_4, y_pred_4, SCHOLARLY_4_LABELS)
    legacy_4class_calc = dataclasses.asdict(MetricsCalculator.compute(y_true_4, y_pred_4))
    cal_result = CalibrationCalculator.compute(cal_pairs)
    per_style = _compute_slice_breakdown(slice_records, "style")
    per_domain = _compute_slice_breakdown(slice_records, "domain")

    report_md = EvaluationReport(
        {
            f"e2e_5class ({mode})": e2e_5class,
            f"scholarly_4class ({mode})": scholarly_4class,
        }
    ).to_markdown()
    print("\n" + report_md)

    print("\nPer-Label Breakdown (5-Class End-to-End):")
    print(f"  {'Label':<26} {'Prec':>8} {'Recall':>8} {'F1':>8} {'Support':>8}")
    for lbl in CANONICAL_5_LABELS:
        pc = e2e_5class["per_class"][lbl]
        print(
            f"  {lbl:<26} {pc['precision']:>7.2%} {pc['recall']:>7.2%} "
            f"{pc['f1']:>7.2%} {pc['support']:>8d}"
        )

    if len(per_style) > 1:
        print("\nPer-Style Accuracy Breakdown:")
        for st, sm in per_style.items():
            print(f"  - {st:<22}: {sm['correct']:>3d}/{sm['count']:<3d} ({sm['accuracy']:.2%})")

    if len(per_domain) > 1:
        print("\nPer-Domain Accuracy Breakdown:")
        for dm, dmm in per_domain.items():
            print(
                f"  - {dm:<38}: {dmm['correct']:>3d}/{dmm['count']:<3d} ({dmm['accuracy']:.2%})"
            )

    cal_dict = cal_result.to_dict()
    brier_val = float(cal_dict.get("brier", cal_dict.get("brier_score", 0.0)))
    print(
        f"\nCalibration & Runtime: ECE={cal_dict['ece']:.4f} | Brier={brier_val:.4f} "
        f"| Elapsed={elapsed_sec:.2f}s ({len(dataset) / max(elapsed_sec, 1e-6):.1f} refs/s)"
    )

    errors = [
        {
            "citation_id": cid,
            "ground_truth": ground_truth[cid],
            "predicted": predictions[cid],
            "confidence": confidences[cid],
            "metadata": metadata[cid],
            "raw": next(
                (it["citation_formatted"] for it in dataset if it["citation_id"] == cid), ""
            ),
        }
        for cid in predictions
        if predictions[cid] != ground_truth[cid]
    ]

    target_out = output_dir or (REPO_ROOT / "data" / "cache" / "evaluation")
    metrics_payload = {
        "mode": mode,
        "elapsed_seconds": round(elapsed_sec, 4),
        "num_samples": len(dataset),
        "classification": e2e_5class,
        "end_to_end_5class": e2e_5class,
        "scholarly_4class": scholarly_4class,
        "scholarly_4class_metrics_calculator": legacy_4class_calc,
        "per_style": per_style,
        "per_domain": per_domain,
        "calibration": cal_dict,
    }
    predictions_payload = {
        "predictions": predictions,
        "confidences": confidences,
        "metadata": metadata,
        "ground_truth": ground_truth,
        "mode": mode,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    pred_path, metrics_path, error_path = await asyncio.to_thread(
        _save_evaluation_artifacts,
        target_out,
        predictions_payload,
        metrics_payload,
        errors,
    )
    print(f"\nSaved predictions: {pred_path}")
    print(f"Saved metrics:     {metrics_path}")
    print(f"Saved errors:      {error_path} ({len(errors)} errors)")

    return {
        "predictions": predictions,
        "ground_truth": ground_truth,
        "metrics": metrics_payload,
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run end-to-end ground-truth evaluation on raw bibliography strings"
    )
    parser.add_argument(
        "--mode",
        choices=("offline", "live"),
        default="offline",
        help="Evaluation mode: 'offline' (deterministic fast CI/demo) or 'live' (15-API network)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional sample limit for quick smoke runs",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="Optional custom ground-truth JSON path",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Optional output directory for evaluation JSON artifacts",
    )
    parser.add_argument(
        "--no-local-db",
        action="store_true",
        help="Disable local_papers.db in offline mode (simulates fresh CI runner)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose debug logging from retrieval and semantic layers",
    )
    args = parser.parse_args()
    if not args.verbose:
        try:
            from loguru import logger as _loguru_logger

            _loguru_logger.remove()
            _loguru_logger.add(sys.stderr, level="ERROR")
        except Exception:  # noqa: BLE001
            pass
    asyncio.run(
        run_evaluation(
            limit=args.limit,
            dataset_path=args.dataset,
            output_dir=args.output_dir,
            mode=args.mode,
            use_local_db=not args.no_local_db,
        )
    )


if __name__ == "__main__":
    main()
