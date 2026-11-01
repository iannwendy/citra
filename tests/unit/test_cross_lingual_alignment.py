"""Unit tests for Full-Scale Cross-Lingual Semantic Alignment (VI <-> EN v2.4)."""

from __future__ import annotations

from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.matching.vn_en_academic_bridge import (
    VN_EN_ACADEMIC_BRIDGE,
    bridge_vn_to_en,
    compute_cross_lingual_concept_overlap,
    find_vn_cues_for_en_source,
    is_vietnamese_text,
    normalize_vn_spelling,
)
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import ValidationLabel


class TestVnEnAcademicBridge:
    """Test multi-domain Vietnamese-English concept dictionary and bidirectional helpers."""

    def test_dictionary_scale_and_spelling_normalization(self):
        assert len(VN_EN_ACADEMIC_BRIDGE) >= 180
        raw_old_tone = "Nghiên cứu về xử lí ngôn ngữ tự nhiên, kĩ thuật phân cụm và lí thuyết xác suất."
        norm = normalize_vn_spelling(raw_old_tone)
        assert "xử lý ngôn ngữ tự nhiên" in norm
        assert "kỹ thuật" in norm
        assert "lý thuyết" in norm
        assert is_vietnamese_text(norm) is True
        assert is_vietnamese_text("Purely English academic sentence without diacritics") is False

    def test_bridge_vn_to_en_multi_domain(self):
        # 1. CS / AI
        is_xl, bridged, concepts = bridge_vn_to_en(
            "Chúng tôi áp dụng mô hình ngôn ngữ lớn và tạo sinh tăng cường truy xuất để giảm ảo giác trích dẫn [1].",
            source_title="Retrieval-Augmented Generation for Large Language Models",
            source_abstract="We mitigate hallucination in LLMs using retrieval grounding.",
        )
        assert is_xl is True
        assert "large language model" in bridged
        assert "retrieval-augmented generation" in bridged
        assert any("mô hình ngôn ngữ lớn" in c for c in concepts)
        assert any("tạo sinh tăng cường truy xuất" in c for c in concepts)

        # 2. Law
        is_xl_law, bridged_law, concepts_law = bridge_vn_to_en(
            "Quy định về bảo vệ dữ liệu cá nhân và bồi thường thiệt hại ngoài hợp đồng trong thương mại điện tử [2].",
            source_title="Personal Data Protection and Non-Contractual Liability in E-Commerce",
        )
        assert is_xl_law is True
        assert "personal data protection" in bridged_law
        assert len(concepts_law) >= 2

        # 3. Economics & Finance
        is_xl_econ, bridged_econ, concepts_econ = bridge_vn_to_en(
            "Tác động của chính sách tiền tệ và đầu tư trực tiếp nước ngoài đến tăng trưởng kinh tế [3].",
            source_title="Monetary Policy, Foreign Direct Investment, and Economic Growth",
        )
        assert is_xl_econ is True
        assert "monetary policy" in bridged_econ
        assert "foreign direct investment" in bridged_econ
        assert len(concepts_econ) >= 2

    def test_compute_cross_lingual_concept_overlap_and_reverse_cues(self):
        vn_sent = "Kỹ thuật tăng cường mẫu thiểu số SMOTE giúp xử lý mất cân bằng dữ liệu hiệu quả."
        en_abs = "SMOTE: Synthetic Minority Over-sampling Technique for imbalanced datasets and classification."
        score, pairs = compute_cross_lingual_concept_overlap(vn_sent, en_abs)
        assert score >= 0.75
        assert len(pairs) >= 2

        vn_cues = find_vn_cues_for_en_source(
            "Antibiotic Resistance and Clinical Trial Outcomes in Bacterial Infections",
            "A randomized clinical study evaluating antimicrobial therapy.",
        )
        assert "kháng kháng sinh" in vn_cues
        assert "thử nghiệm lâm sàng" in vn_cues or "lâm sàng" in vn_cues


class TestCrossLingualSemanticMatcher:
    """Test deep neural cross-lingual content alignment, stance NLI, and intent classification."""

    def test_cross_lingual_content_alignment_across_domains(self):
        sm = SemanticMatcher.get_instance()

        # Economics & Banking
        res_econ = sm.check_content_alignment(
            cited_context=(
                "Nghiên cứu thực nghiệm cho thấy quản trị rủi ro tín dụng tại các ngân hàng thương mại "
                "giúp giảm tỷ lệ nợ xấu và ổn định thị trường tài chính [5]."
            ),
            source_title="Credit Risk Management and Non-Performing Loans in Commercial Banks",
            source_abstract=(
                "This empirical study investigates how credit risk management practices in commercial banks "
                "reduce default probabilities and non-performing loans."
            ),
            citation_marker="[5]",
        )
        assert res_econ.cross_lingual_detected is True
        assert res_econ.is_aligned is True
        assert res_econ.similarity >= 0.55
        assert res_econ.stance_label == "supported"
        assert len(res_econ.bridged_concepts) >= 2

        # IoT & Smart Grid
        res_iot = sm.check_content_alignment(
            cited_context=(
                "Hệ thống kết hợp internet vạn vật và điện toán biên để tối ưu hóa điều độ năng lượng tái tạo "
                "trong lưới điện thông minh [8]."
            ),
            source_title="Edge Computing and IoT for Renewable Energy Optimization in Smart Grids",
            source_abstract=(
                "We propose an Internet of Things (IoT) and edge computing architecture for real-time "
                "renewable solar and wind energy scheduling in smart power grids."
            ),
            citation_marker="[8]",
        )
        assert res_iot.cross_lingual_detected is True
        assert res_iot.is_aligned is True
        assert res_iot.similarity >= 0.60
        assert res_iot.citation_intent in ("methodology", "background")

    def test_cross_lingual_polarity_inversion_triggers_contradiction_risk(self):
        checker = NeuroSymbolicChecker()
        cit = Citation(
            raw_text="Chawla, N. V., Bowyer, K. W., Hall, L. O., & Kegelmeyer, W. P. (2002). SMOTE: Synthetic minority over-sampling technique. JAIR, 16, 321-357.",
            title="SMOTE: Synthetic minority over-sampling technique",
            authors=["Chawla, N. V.", "Bowyer, K. W.", "Hall, L. O.", "Kegelmeyer, W. P."],
            year=2002,
            doi="10.1613/jair.953",
        )
        src = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    title="SMOTE: Synthetic Minority Over-sampling Technique",
                    authors=["N. V. Chawla", "K. W. Bowyer", "L. O. Hall", "W. P. Kegelmeyer"],
                    year=2002,
                    doi="10.1613/jair.953",
                    abstract=(
                        "We propose an over-sampling approach in which the minority class is over-sampled "
                        "by creating synthetic examples, which significantly improves classification accuracy "
                        "and outperforms naive oversampling on imbalanced datasets."
                    ),
                    confidence=0.98,
                    score=0.98,
                )
            ],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )

        # Student claims in Vietnamese that SMOTE completely fails and degrades accuracy
        contradicting_vn_context = (
            "Tuy nhiên, Chawla và cộng sự (2002) đã chứng minh rằng kỹ thuật tăng cường mẫu thiểu số SMOTE "
            "hoàn toàn thất bại và làm giảm độ chính xác khi xử lý dữ liệu mất cân bằng (Chawla et al., 2002)."
        )
        verdict = checker.check(cit, src, citation_context=contradicting_vn_context)
        assert verdict.features.cross_lingual_detected is True
        assert verdict.features.stance_label == "contradiction_risk"
        assert "R-CONTENT-MISMATCH" in verdict.triggered_rules

    def test_cross_lingual_translated_title_triggers_metadata_error_per_tdtu_rules(self):
        """When a student translates an English paper title into Vietnamese without keeping the original
        English title, CITRA must detect the cross-lingual title match and flag METADATA_ERROR ('title')
        reminding the student to preserve the original foreign title.
        """
        checker = NeuroSymbolicChecker()
        # Student translated "Deep Learning for Natural Language Processing" into Vietnamese
        cit_translated = Citation(
            raw_text="Goodfellow, I., Bengio, Y., & Courville, A. (2016). Học sâu cho xử lý ngôn ngữ tự nhiên và mạng nơ-ron tích chập. MIT Press.",
            title="Học sâu cho xử lý ngôn ngữ tự nhiên và mạng nơ-ron tích chập",
            authors=["Goodfellow, I.", "Bengio, Y.", "Courville, A."],
            year=2016,
        )
        src = SourceResult(
            citation_raw=cit_translated.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="openalex",
                    found=True,
                    title="Deep Learning for Natural Language Processing and Convolutional Neural Networks",
                    authors=["Ian Goodfellow", "Yoshua Bengio", "Aaron Courville"],
                    year=2016,
                    venue="MIT Press",
                    confidence=0.92,
                    score=0.92,
                )
            ],
            sources_queried=["openalex", "crossref"],
            sources_succeeded=["openalex", "crossref"],
        )

        verdict = checker.check(
            cit_translated,
            src,
            citation_context="Mô hình học sâu và mạng nơ-ron tích chập được áp dụng cho xử lý ngôn ngữ tự nhiên (Goodfellow et al., 2016).",
        )
        assert verdict.features.cross_lingual_title_detected is True
        assert verdict.features.cross_lingual_title_sim >= 0.60
        assert verdict.label == ValidationLabel.METADATA_ERROR
        assert "R-CROSS-LINGUAL-TITLE-MATCH" in verdict.triggered_rules
        assert "title" in verdict.mismatched_fields
        assert "original language" in verdict.reasoning

    def test_bilingual_bracketed_or_parallel_title_is_verified(self):
        """When the student keeps the original English title and appends the Vietnamese translation
        in brackets or parallel '=' format, the reference is VERIFIED.
        """
        fc = FeatureCalculator()
        cit_bilingual = Citation(
            raw_text="Vaswani, A. et al. (2017). Attention Is All You Need [Cơ chế chú ý là tất cả những gì bạn cần]. NeurIPS.",
            title="Attention Is All You Need [Cơ chế chú ý là tất cả những gì bạn cần]",
            authors=["Vaswani, A."],
            year=2017,
        )
        src = SourceResult(
            citation_raw=cit_bilingual.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    title="Attention Is All You Need",
                    authors=["Ashish Vaswani"],
                    year=2017,
                    confidence=0.98,
                    score=0.98,
                )
            ],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
        feats = fc.compute(cit_bilingual, src)
        assert feats.title_sim_fuzzy >= 0.98
        assert feats.cross_lingual_title_detected is False

        # Also test ISBD parallel '=' title format
        cit_parallel = Citation(
            raw_text="Le, Q. V., & Mikolov, T. (2014). Distributed Representations of Sentences and Documents = Biểu diễn phân tán của câu và văn bản. ICML.",
            title="Distributed Representations of Sentences and Documents = Biểu diễn phân tán của câu và văn bản",
            authors=["Le, Q. V.", "Mikolov, T."],
            year=2014,
        )
        src_parallel = SourceResult(
            citation_raw=cit_parallel.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="dblp",
                    found=True,
                    title="Distributed Representations of Sentences and Documents",
                    authors=["Quoc V. Le", "Tomas Mikolov"],
                    year=2014,
                    confidence=0.95,
                    score=0.95,
                )
            ],
            sources_queried=["dblp"],
            sources_succeeded=["dblp"],
        )
        feats_par = fc.compute(cit_parallel, src_parallel)
        assert feats_par.title_sim_fuzzy >= 0.98
        assert feats_par.cross_lingual_title_detected is False

    def test_symbolic_rules_direct_cross_lingual_title_match_for_non_whitelist_paper(self):
        """Test Rule 1d (R-CROSS-LINGUAL-TITLE-MATCH) in SymbolicRules for a non-whitelist author/paper."""
        checker = NeuroSymbolicChecker()
        cit = Citation(
            raw_text="Smith, J. R., & Anderson, K. L. (2022). Phát hiện xâm nhập mạng bằng học liên kết và chuỗi khối. IEEE Transactions.",
            title="Phát hiện xâm nhập mạng bằng học liên kết và chuỗi khối",
            authors=["Smith, J. R.", "Anderson, K. L."],
            year=2022,
        )
        src = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    title="Network Intrusion Detection Using Federated Learning and Blockchain",
                    authors=["John R. Smith", "Karen L. Anderson"],
                    year=2022,
                    confidence=0.91,
                    score=0.91,
                )
            ],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref", "openalex"],
        )
        verdict = checker.check(
            cit,
            src,
            citation_context="Nhóm tác giả đề xuất hệ thống phát hiện xâm nhập kết hợp học liên kết và chuỗi khối (Smith & Anderson, 2022).",
        )
        assert verdict.label == ValidationLabel.METADATA_ERROR
        assert "R-CROSS-LINGUAL-TITLE-MATCH" in verdict.triggered_rules
        assert "title" in verdict.mismatched_fields
        assert verdict.features.cross_lingual_title_detected is True
        assert verdict.features.cross_lingual_detected is True
        assert "R-CROSS-LINGUAL-ALIGNMENT" in verdict.triggered_rules

    def test_implicit_body_discovery_reverse_en_to_vi_bridge(self):
        """When an English bibliography entry is uncited in a Vietnamese thesis body,
        discover_implicit_body_context should use reverse EN->VI concept cues to find the Vietnamese paragraph.
        """
        sm = SemanticMatcher.get_instance()
        body_pages = [
            (
                1,
                "Chương 1 trình bày tổng quan về lịch sử hình thành của đơn vị thực tập và cơ cấu tổ chức nhân sự phòng ban.",
            ),
            (
                4,
                "Trong giai đoạn tiền xử lý, để khắc phục tình trạng mất cân bằng dữ liệu nghiêm trọng giữa các nhãn, "
                "khóa luận sử dụng phương pháp tăng cường mẫu thiểu số kết hợp phân cụm mật độ nhằm nâng cao chất lượng tập huấn luyện.",
            ),
        ]
        found = sm.discover_implicit_body_context(
            body_pages=body_pages,
            source_title="Density-Based Clustering and Synthetic Minority Over-Sampling for Imbalanced Datasets",
            source_abstract="We combine HDBSCAN density-based clustering with SMOTE oversampling to address severe class imbalance.",
            source_authors=["R. Johnson"],
        )
        assert found is not None
        page_num, best_passage, sim_score = found
        assert page_num == 4
        assert "mất cân bằng dữ liệu" in best_passage
        assert sim_score >= 0.40

    def test_multi_occurrence_cross_lingual_alignment_and_intent_classification(self):
        sm = SemanticMatcher.get_instance()
        occurrences = [
            {
                "page": 2,
                "raw": "[10]",
                "context": "Trong quy trình hệ thống, chúng tôi triển khai và áp dụng kiến trúc cơ chế tự chú ý để trích xuất đặc trưng văn bản [10].",
            },
            {
                "page": 8,
                "raw": "[10]",
                "context": "Kết quả thực nghiệm trong Bảng 3 cho thấy độ chính xác F1 đạt được 94.5%, vượt trội hơn so với mô hình hồi quy [10].",
            },
        ]
        occ_results = sm.check_multi_context_alignment(
            occurrences,
            source_title="Self-Attention Feature Extraction for Text Classification",
            source_abstract=(
                "We propose a self-attention architecture for text feature extraction. "
                "Experimental evaluation demonstrates 94.5% F1 accuracy, outperforming baseline logistic regression."
            ),
        )
        assert len(occ_results) == 2
        assert occ_results[0]["intent"] == "methodology"
        assert occ_results[1]["intent"] == "result_comparison"
        assert occ_results[0]["cross_lingual_detected"] is True
        assert len(occ_results[0]["bridged_concepts"]) >= 1

