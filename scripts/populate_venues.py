#!/usr/bin/env python3
"""Populate missing venue information for papers in local_papers.db.

Known papers (known_papers source) are canonical NLP papers with well-known venues.
This script populates their venues based on conservative word-boundary mappings
without overwriting unknown papers with blanket source-level defaults.

Usage:
    python scripts/populate_venues.py         # dry-run
    python scripts/populate_venues.py --apply # write changes
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.database import LocalDatabase  # noqa: E402

# Unambiguous multi-word or hyphenated NLP/ML paper titles & identifiers.
# Checked BEFORE standalone acronyms so compound names ("Sentence-BERT") win over "BERT".
_PHRASE_VENUE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(rf"(?<![A-Za-z0-9-]){re.escape(phrase)}(?![A-Za-z0-9-])", re.IGNORECASE), venue)
    for phrase, venue in (
        ("attention is all you need", "NeurIPS"),
        ("efficient estimation of word representations", "ICLR Workshop"),
        ("word2vec", "NeurIPS Workshop"),
        ("decomposable attention model", "EMNLP"),
        ("convolutional neural networks for sentence classification", "EMNLP"),
        ("neural machine translation of rare words", "ACL"),
        ("language models are few-shot learners", "NeurIPS"),
        ("gpt-3", "NeurIPS"),
        ("deep contextualized word representations", "NAACL"),
        ("skip-thought vectors", "NeurIPS"),
        ("google's neural machine translation", "NeurIPS"),
        ("qanet", "ICLR"),
        ("long short-term memory", "Neural Computation"),
        ("fast and accurate dependency parser", "EMNLP"),
        ("learning sentence representations", "ICLR"),
        ("triviaqa", "EMNLP"),
        ("exploring the limits of transfer learning", "JMLR"),
        ("learning transferable visual models from natural language supervision", "ICML"),
        ("training compute-optimal large language models", "NeurIPS"),
        ("dall-e", "ICML"),
        ("gpt-2", "arXiv"),
        ("xlnet", "NeurIPS"),
        ("distilbert", "INTERSPEECH"),
        ("sentence-bert", "EMNLP"),
        ("spanbert", "TACL"),
        ("infobert", "ICLR"),
        ("tinybert", "EMNLP"),
        ("mobilebert", "ACL"),
        ("linformer", "arXiv"),
        ("bigbird", "NeurIPS"),
        ("longformer", "arXiv"),
        ("gpt-j", "arXiv"),
        ("gpt-neox", "arXiv"),
        ("llama 2", "arXiv"),
        ("mixtral", "arXiv"),
        ("one billion word", "EMNLP"),
        ("learned in translation", "NeurIPS"),
        ("denoising autoencoders", "ICML"),
        ("neural gpus", "ICLR"),
    )
)

# Short acronyms / English homographs require canonical casing, forbid hyphenated affixes
# (e.g., HITS-CLIP / Sentence-BERT), and require subtitle colons on English homographs.
# Specific compound/derived model names (RoBERTa, ALBERT, SuperGLUE) precede base names (BERT, GLUE)
# so subtitles mentioning BERT/GLUE (e.g. "RoBERTa: A Robustly Optimized BERT...") match the primary model.
_CASED_ACRONYM_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?<![A-Za-z0-9-])RoBERTa(?![A-Za-z0-9-])"), "EMNLP"),
    (re.compile(r"(?<![A-Za-z0-9-])ALBERT\s*:"), "ICLR"),
    (re.compile(r"(?<![A-Za-z0-9-])SuperGLUE(?![A-Za-z0-9-])"), "NeurIPS"),
    (re.compile(r"(?<![A-Za-z0-9-])BERT(?![A-Za-z0-9-])"), "NAACL"),
    (re.compile(r"(?<![A-Za-z0-9-])SQuAD(?![A-Za-z0-9-])"), "EMNLP"),
    (re.compile(r"(?<![A-Za-z0-9-])GLUE\s*:"), "ICLR"),
    (re.compile(r"(?<![A-Za-z0-9-])BART\s*:"), "ACL"),
    (re.compile(r"(?<![A-Za-z0-9-])CLIP\s*:"), "ICML"),
    (re.compile(r"(?<![A-Za-z0-9-])ELECTRA\s*:"), "ICLR"),
    (re.compile(r"(?<![A-Za-z0-9-])SWAG\s*:"), "EMNLP"),
    (re.compile(r"(?<![A-Za-z0-9-])CTRL\s*:"), "arXiv"),
    (re.compile(r"(?<![A-Za-z0-9-])PaLM(?![A-Za-z0-9-])"), "JMLR"),
    (re.compile(r"(?<![A-Za-z0-9-])Chinchilla\s*:"), "NeurIPS"),
    (re.compile(r"(?<![A-Za-z0-9-])LLaMA(?![A-Za-z0-9-])"), "arXiv"),
    (re.compile(r"(?<![A-Za-z0-9-])Vicuna\s*:"), "ICLR Workshop"),
)

_CROSSREF_REGEX_MAP: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(pattern, re.IGNORECASE), venue)
    for pattern, venue in (
        (r"\bclass-based n-gram models?\b", "Computational Linguistics"),
        (r"\bautomatically constructing a corpus of sentential paraphrases\b", "COLING"),
        (r"\bidentifying predictive structures\b", "JMLR"),
        (r"\bdomain adaptation with structural correspondence learning\b", "EMNLP"),
        (r"\bmultiway attention networks\b", "IJCAI"),
        (r"\bsimple and effective multi-paragraph reading comprehension\b", "ACL"),
        (r"\bsemi-supervised sequence modeling\b", "NeurIPS"),
        (r"\blearning distributed representations of sentences\b", "NAACL"),
        (r"\bulmfit\b", "ACL"),
        (r"\breinforced mnemonic reader\b", "IJCAI"),
        (r"\baligning books and movies\b", "ICCV"),
        (r"\bwinograd schema challenge\b", "KR"),
        (r"\bglove:\s*global vectors for word representation\b", "EMNLP"),
        (r"\bcontext2vec\b", "CoNLL"),
        (r"\bdissecting contextual word embeddings\b", "EMNLP"),
        (r"\badversarial examples for evaluating reading comprehension\b", "EMNLP"),
        (r"\bword representations:\s*a simple and general method\b", "ACL"),
        (r"\bbroad-coverage challenge corpus\b", "NAACL"),
        (r"\bdeep residual learning for image recognition\b", "CVPR"),
        (r"\bsequence-to-sequence learning as beam-search\b", "EMNLP"),
        (r"\badversarial multi-task learning\b", "ACL"),
        (r"\blarge annotated corpus for learning natural language inference\b", "EMNLP"),
        (r"\bhierarchical neural autoencoder\b", "ACL"),
        (r"\bleveraging linguistic structure for open domain information extraction\b", "ACL"),
        (r"\bluke:\s*deep contextualized entity representations\b", "EMNLP"),
        (r"\bdropout:\s*a simple way to prevent neural networks from overfitting\b", "JMLR"),
        (r"\bfast and accurate shift-reduce constituent parsing\b", "ACL"),
        (r"\bneural architectures for named entity recognition\b", "NAACL"),
        (r"\bbuilding a large annotated corpus of english:\s*the penn treebank\b", "CL"),
        (r"\bdiagnostic and statistical manual\b", "APA"),
    )
)


def _infer_venue(title: str | None, source: str) -> str | None:
    """Infer venue from title using word-bounded canonical patterns only."""
    if not title or not title.strip():
        return None

    clean_title = title.strip()

    for pat, venue in _PHRASE_VENUE_PATTERNS:
        if pat.search(clean_title):
            return venue

    for pat, venue in _CASED_ACRONYM_PATTERNS:
        if pat.search(clean_title):
            return venue

    if source == "crossref":
        for pat, venue in _CROSSREF_REGEX_MAP:
            if pat.search(clean_title):
                return venue
        if re.search(r"\barxiv\b", clean_title, re.IGNORECASE):
            return "arXiv"

    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db-path",
        type=Path,
        default=Path("./data/local_papers.db"),
        help="Path to the local papers database",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist changes (default is a dry run)",
    )
    args = parser.parse_args()

    db = LocalDatabase(args.db_path)

    with db._get_conn() as conn:
        result = conn.execute(
            "SELECT id, title, source, year FROM papers "
            "WHERE venue IS NULL OR venue = '' OR venue = 'acl'"
        ).fetchall()

    print(f"Found {len(result)} papers with missing/unset venues")

    to_update: list[tuple[str, int]] = []
    for row in result:
        venue = _infer_venue(row["title"], row["source"])
        if venue and row["source"] != "acl":
            to_update.append((venue, row["id"]))

    print(f"Will update {len(to_update)} papers")

    for venue, paper_id in to_update[:20]:
        print(f"  ID {paper_id}: venue = '{venue}'")
    if len(to_update) > 20:
        print(f"  ... and {len(to_update) - 20} more")

    if args.apply:
        with db._get_conn() as conn:
            for venue, paper_id in to_update:
                conn.execute(
                    "UPDATE papers SET venue = ? WHERE id = ?",
                    (venue, paper_id),
                )
            conn.commit()
        print(f"[APPLIED] Updated {len(to_update)} venues")
    else:
        print("[DRY-RUN] Pass --apply to write changes")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
