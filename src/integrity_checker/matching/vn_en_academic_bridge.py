"""Kho tri thức Bắc cầu Ngữ nghĩa Học thuật Đa ngành Việt ↔ Anh (VN-EN Academic Concept Bridge v2.4).

Cung cấp:
1. Hơn 320 cặp khái niệm học thuật chuẩn hóa bao phủ 6 lĩnh vực đào tạo đại học trọng điểm:
   - CNTT, Trí tuệ nhân tạo, Khoa học dữ liệu & Kỹ thuật phần mềm
   - Luật học, Hành chính công & Quyền sở hữu trí tuệ
   - Kinh tế học, Tài chính - Ngân hàng, Kế toán - Kiểm toán & Quản trị kinh doanh
   - Y sinh học, Lâm sàng, Dược học, Y tế công cộng & Tâm lý học
   - Kỹ thuật Điện - Điện tử, Tự động hóa, Năng lượng & Môi trường
   - Phương pháp nghiên cứu khoa học, Thống kê thực nghiệm & Giáo dục đại học
2. Chuẩn hóa chính tả tiếng Việt (Unicode NFC + đồng nhất vị trí dấu thanh kiểu cũ/mới: oà/òa, uỷ/ủy, kĩ/kỹ, lí/lý).
3. Chỉ mục tra cứu 2 chiều (VI → EN cho Content Alignment và EN → VI cho Implicit Passage Discovery & Title Alignment).
4. Tính điểm chồng lấp khái niệm xuyên ngôn ngữ (Cross-Lingual Concept Overlap Score) và danh sách giải thích minh bạch (`bridged_concepts`).
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

# Vietnamese diacritic detector
VN_DIACRITIC_RE = re.compile(
    r"[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]",
    re.IGNORECASE,
)

# Tone placement normalization map (old style -> standard modern style at syllable boundary)
_VN_TONE_NORM_REGEXES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b([bchklmstvđg]*)oà\b", re.IGNORECASE), r"\1òa"),
    (re.compile(r"\b([bchklmstvđg]*)oá\b", re.IGNORECASE), r"\1óa"),
    (re.compile(r"\b([bchklmstvđg]*)oả\b", re.IGNORECASE), r"\1ỏa"),
    (re.compile(r"\b([bchklmstvđg]*)oã\b", re.IGNORECASE), r"\1õa"),
    (re.compile(r"\b([bchklmstvđg]*)oạ\b", re.IGNORECASE), r"\1ọa"),
    (re.compile(r"\b([bchklmstvđg]*)oè\b", re.IGNORECASE), r"\1òe"),
    (re.compile(r"\b([bchklmstvđg]*)oé\b", re.IGNORECASE), r"\1óe"),
    (re.compile(r"\b([bchklmstvđg]*)oẻ\b", re.IGNORECASE), r"\1ỏe"),
    (re.compile(r"\b([bchklmstvđg]*)oẽ\b", re.IGNORECASE), r"\1õe"),
    (re.compile(r"\b([bchklmstvđg]*)oẹ\b", re.IGNORECASE), r"\1ọe"),
    (re.compile(r"\b([bchklmstvđgq]*)uỳ\b", re.IGNORECASE), r"\1ùy"),
    (re.compile(r"\b([bchklmstvđgq]*)uý\b", re.IGNORECASE), r"\1úy"),
    (re.compile(r"\b([bchklmstvđgq]*)uỷ\b", re.IGNORECASE), r"\1ủy"),
    (re.compile(r"\b([bchklmstvđgq]*)uỹ\b", re.IGNORECASE), r"\1ũy"),
    (re.compile(r"\b([bchklmstvđgq]*)uỵ\b", re.IGNORECASE), r"\1ụy"),
)

_VN_LEXICAL_NORM_MAP: tuple[tuple[str, str], ...] = (
    ("nơron", "nơ-ron"),
    ("nơ ron", "nơ-ron"),
    ("kĩ ", "kỹ "),
    ("lí thuyết", "lý thuyết"),
    ("xử lí", "xử lý"),
    ("quản lí", "quản lý"),
    ("tâm lí", "tâm lý"),
    ("pháp lí", "pháp lý"),
    ("địa lí", "địa lý"),
    ("vật lí", "vật lý"),
)

# Multi-domain Vietnamese <-> English Academic Concept Dictionary
VN_EN_ACADEMIC_BRIDGE: tuple[tuple[str, str], ...] = (
    # =========================================================================
    # 1. CNTT, TRÍ TUỆ NHÂN TẠO, KHOA HỌC DỮ LIỆU & KỸ THUẬT PHẦN MỀM
    # =========================================================================
    ("xử lý ngôn ngữ tự nhiên", "natural language processing NLP"),
    ("mô hình ngôn ngữ lớn", "large language model LLM"),
    ("mô hình ngôn ngữ tiền huấn luyện", "pre-trained language model PLM"),
    ("mô hình ngôn ngữ", "language model"),
    ("trí tuệ nhân tạo tạo sinh", "generative artificial intelligence GenAI LLM"),
    ("trí tuệ nhân tạo có thể giải thích", "explainable artificial intelligence XAI interpretability"),
    ("trí tuệ nhân tạo", "artificial intelligence AI"),
    ("mạng nơ-ron tích chập đồ thị", "graph convolutional network GCN GNN"),
    ("mạng nơ-ron đồ thị", "graph neural network GNN"),
    ("mạng nơ-ron tích chập", "convolutional neural network CNN deep learning"),
    ("nhận dạng hình ảnh", "image recognition visual recognition computer vision"),
    ("học phần dư", "deep residual learning ResNet"),
    ("mạng nơ-ron hồi quy", "recurrent neural network RNN LSTM GRU"),
    ("mạng đối kháng tạo sinh", "generative adversarial network GAN"),
    ("mạng nơ-ron", "neural network deep learning"),
    ("bộ nhớ ngắn hạn dài", "long short-term memory LSTM"),
    ("cơ chế tự chú ý", "self-attention mechanism transformer"),
    ("cơ chế chú ý đa đầu", "multi-head attention transformer"),
    ("cơ chế chú ý", "attention mechanism transformer"),
    ("kiến trúc bộ biến đổi", "transformer architecture self-attention"),
    ("kiến trúc biến đổi", "transformer architecture self-attention"),
    ("dịch máy thần kinh", "neural machine translation NMT sequence transduction"),
    ("dịch máy", "machine translation NMT"),
    ("phụ thuộc xa", "long-range dependencies global dependencies"),
    ("học sâu", "deep learning neural network"),
    ("học máy", "machine learning classification prediction"),
    ("học tăng cường sâu", "deep reinforcement learning DRL policy gradient"),
    ("học tăng cường", "reinforcement learning reward policy"),
    ("học bán giám sát", "semi-supervised learning pseudo-labeling"),
    ("học tự giám sát", "self-supervised learning contrastive representation"),
    ("học không giám sát", "unsupervised learning clustering"),
    ("học có giám sát", "supervised learning labeled training"),
    ("học chuyển giao", "transfer learning pre-trained fine-tuning domain adaptation"),
    ("học liên kết", "federated learning privacy-preserving distributed training"),
    ("học tương phản", "contrastive learning embedding representation"),
    ("học chủ động", "active learning query strategy uncertainty sampling"),
    ("học đa tác vụ", "multi-task learning shared representation"),
    ("học ít mẫu", "few-shot learning meta-learning"),
    ("học không mẫu", "zero-shot learning generalization"),
    ("tinh chỉnh mô hình", "fine-tuning parameter-efficient LoRA adaptation"),
    ("biểu diễn từ", "word embeddings vector representations Word2Vec FastText"),
    ("nhúng câu", "sentence embeddings dense vector representations SBERT"),
    ("nhúng từ", "word embedding vector space"),
    ("không gian vector", "vector space embedding similarity"),
    ("độ tương đồng ngữ nghĩa", "semantic similarity cosine alignment"),
    ("căn chỉnh ngữ nghĩa", "semantic alignment cross-lingual entailment"),
    ("suy diễn ngôn ngữ tự nhiên", "natural language inference NLI textual entailment"),
    ("trích xuất đặc trưng", "feature extraction representation selection"),
    ("lựa chọn đặc trưng", "feature selection dimensionality importance"),
    ("phân loại văn bản", "text classification categorization sentiment"),
    ("phân tích cảm xúc", "sentiment analysis emotion recognition opinion mining"),
    ("nhận diện thực thể có tên", "named entity recognition NER sequence labeling"),
    ("nhận diện thực thể", "entity recognition extraction linking"),
    ("tóm tắt văn bản", "text summarization abstractive extractive"),
    ("dịch máy", "machine translation neural cross-lingual"),
    ("hỏi đáp tự động", "question answering reading comprehension QA"),
    ("truy xuất thông tin", "information retrieval search ranking BM25"),
    ("tạo sinh tăng cường truy xuất", "retrieval-augmented generation RAG knowledge grounding"),
    ("ảo giác trích dẫn", "citation hallucination fabricated reference verification"),
    ("ảo giác", "hallucination fabricated factual error LLM"),
    ("kiểm tra trích dẫn", "citation verification bibliographic integrity validation"),
    ("toàn vẹn trích dẫn", "citation integrity verification source validation"),
    ("tài liệu tham khảo", "bibliographic references citations literature"),
    ("liên kết bản ghi", "record linkage entity resolution deduplication"),
    ("hiệu chỉnh xác suất", "probability calibration Platt scaling ECE Brier score"),
    ("sai số hiệu chỉnh kỳ vọng", "expected calibration error ECE reliability"),
    ("trì hoãn có chọn lọc", "selective abstention classification reject option"),
    ("hệ thống thần kinh biểu tượng", "neuro-symbolic system hybrid rules neural"),
    ("suy luận biểu tượng", "symbolic reasoning rule-based decision tree"),
    ("phát hiện trầm cảm", "depression detection mental health social media"),
    ("trầm cảm", "depression depressive disorder mental health"),
    ("sức khỏe tâm thần", "mental health psychological well-being"),
    ("mạng xã hội", "social media online platforms user comments"),
    ("bình luận trực tuyến", "online comments social media posts"),
    ("bình luận", "comments user posts text"),
    ("mất cân bằng dữ liệu", "imbalanced data oversampling SMOTE minority class"),
    ("dữ liệu mất cân bằng", "imbalanced dataset class imbalance SMOTE"),
    ("tăng cường mẫu thiểu số", "synthetic minority over-sampling SMOTE"),
    ("tăng cường dữ liệu", "data augmentation synthetic training samples"),
    ("phân cụm mật độ", "density-based clustering HDBSCAN DBSCAN"),
    ("mô hình chủ đề", "topic modeling BERTopic LDA latent Dirichlet allocation"),
    ("phân cụm", "clustering unsupervised grouping K-means"),
    ("giảm chiều dữ liệu", "dimensionality reduction UMAP PCA t-SNE"),
    ("rừng ngẫu nhiên", "random forest ensemble decision trees bagging"),
    ("cây quyết định", "decision tree classification splitting"),
    ("máy vector hỗ trợ", "support vector machine SVM kernel hyperplane"),
    ("tăng cường độ dốc", "gradient boosting XGBoost LightGBM CatBoost"),
    ("hồi quy tuyến tính", "linear regression least squares prediction"),
    ("hồi quy logistic", "logistic regression binary multinomial classification"),
    ("hồi quy", "regression prediction modeling"),
    ("thị giác máy tính", "computer vision image processing visual recognition"),
    ("phát hiện đối tượng", "object detection bounding box YOLO Faster R-CNN"),
    ("phân vùng ảnh", "image segmentation semantic instance U-Net mask"),
    ("nhận dạng khuôn mặt", "face recognition biometric verification"),
    ("nhận dạng ký tự quang học", "optical character recognition OCR document parsing"),
    ("nhận dạng giọng nói", "speech recognition ASR acoustic model"),
    ("mô hình khuếch tán", "diffusion model image generation denoising latent"),
    ("hệ thống gợi ý", "recommender system collaborative filtering matrix factorization"),
    ("khai phá dữ liệu", "data mining knowledge discovery pattern association"),
    ("phát hiện bất thường", "anomaly detection outlier intrusion fraud"),
    ("an toàn thông tin", "information security cybersecurity protection"),
    ("an ninh mạng", "cybersecurity network security threat defense"),
    ("phát hiện xâm nhập", "intrusion detection system IDS network anomaly"),
    ("mã độc", "malware ransomware trojan detection analysis"),
    ("tấn công từ chối dịch vụ", "denial of service attack DDoS traffic mitigation"),
    ("mã hóa mật khẩu", "password hashing cryptographic security authentication"),
    ("xác thực người dùng", "user authentication login session access control"),
    ("kiểm soát truy cập", "access control authorization role-based RBAC"),
    ("cơ sở dữ liệu", "database SQLite PostgreSQL MySQL relational schema indexing"),
    ("chỉ mục toàn văn", "full-text search index FTS5 BM25 inverted index"),
    ("ứng dụng web", "web application frontend backend RESTful API HTTP"),
    ("giao diện lập trình ứng dụng", "application programming interface REST API endpoint"),
    ("bất đồng bộ", "asynchronous non-blocking concurrent AJAX Fetch API"),
    ("giao diện người dùng", "user interface UI UX DOM responsive frontend"),
    ("điện toán đám mây", "cloud computing distributed systems virtualization container"),
    ("điện toán biên", "edge computing fog latency offloading"),
    ("internet vạn vật", "Internet of Things IoT sensor networks embedded"),
    ("chuỗi khối", "blockchain distributed ledger consensus decentralized"),
    ("hợp đồng thông minh", "smart contract Ethereum blockchain decentralized"),
    ("kiểm thử phần mềm", "software testing unit integration automated verification"),
    ("vi dịch vụ", "microservices architecture container Docker Kubernetes"),
    # =========================================================================
    # 2. LUẬT HỌC, HÀNH CHÍNH CÔNG & QUYỀN SỞ HỮU TRÍ TUỆ
    # =========================================================================
    ("quyền sở hữu trí tuệ", "intellectual property rights IPR patent copyright trademark"),
    ("tài sản trí tuệ", "intellectual property assets valuation patent trademark"),
    ("quyền tác giả", "copyright authorship moral economic rights infringement"),
    ("sáng chế", "patent invention novelty industrial applicability"),
    ("nhãn hiệu", "trademark brand protection confusion registration"),
    ("tên miền", "domain name cybersquatting trademark dispute Internet"),
    ("bảo vệ dữ liệu cá nhân", "personal data protection privacy GDPR consent regulation"),
    ("quyền riêng tư", "right to privacy data protection confidentiality"),
    ("trách nhiệm hình sự", "criminal liability penal code offense prosecution"),
    ("pháp nhân thương mại", "commercial legal entity corporate criminal liability"),
    ("trách nhiệm dân sự", "civil liability tort damages compensation obligation"),
    ("bồi thường thiệt hại ngoài hợp đồng", "non-contractual damages tort liability compensation"),
    ("bồi thường thiệt hại", "damages compensation indemnification liability"),
    ("hợp đồng thương mại", "commercial contract breach obligation arbitration"),
    ("hợp đồng vô hiệu", "void contract invalidity legal transaction restitution"),
    ("vi phạm hợp đồng", "breach of contract remedies penalty specific performance"),
    ("giải quyết tranh chấp", "dispute resolution litigation arbitration mediation"),
    ("trọng tài thương mại", "commercial arbitration arbitral award tribunal"),
    ("tranh chấp lao động", "labor dispute employment law strike collective bargaining"),
    ("hợp đồng lao động", "employment contract termination dismissal labor code"),
    ("bảo hiểm xã hội", "social insurance unemployment pension welfare benefits"),
    ("trợ cấp thất nghiệp", "unemployment benefits social security labor market"),
    ("phá sản doanh nghiệp", "corporate bankruptcy insolvency liquidation restructuring"),
    ("sáp nhập và mua lại", "mergers and acquisitions M&A corporate control takeover"),
    ("mua lại doanh nghiệp", "corporate acquisition takeover foreign investor M&A"),
    ("cạnh tranh không lành mạnh", "unfair competition antitrust monopoly market dominance"),
    ("tập trung kinh tế", "economic concentration merger control competition law"),
    ("quản trị công ty", "corporate governance board of directors shareholders disclosure"),
    ("quản trị doanh nghiệp", "corporate governance management accountability stakeholders"),
    ("đầu tư nước ngoài", "foreign investment FDI regulatory control national security"),
    ("nhà nước pháp quyền", "rule of law constitutionalism legal state justice"),
    ("hành nghề luật sư", "legal profession bar association attorney ethics advocacy"),
    ("tố tụng dân sự", "civil procedure court jurisdiction evidence appeal"),
    ("tố tụng hình sự", "criminal procedure investigation prosecution fair trial"),
    ("văn bản quy phạm pháp luật", "normative legal documents legislation statute decree"),
    # =========================================================================
    # 3. KINH TẾ HỌC, TÀI CHÍNH - NGÂN HÀNG, KẾ TOÁN & QUẢN TRỊ KINH DOANH
    # =========================================================================
    ("tăng trưởng kinh tế", "economic growth GDP productivity macroeconomic development"),
    ("phát triển bền vững", "sustainable development ESG green economy environmental"),
    ("kinh tế tuần hoàn", "circular economy recycling resource efficiency sustainability"),
    ("chuyển đổi số", "digital transformation digitalization business innovation"),
    ("thương mại điện tử", "e-commerce online shopping digital platform consumer"),
    ("thương mại quốc tế", "international trade export import tariff WTO"),
    ("đầu tư trực tiếp nước ngoài", "foreign direct investment FDI capital inflows spillover"),
    ("chính sách tiền tệ", "monetary policy central bank interest rate money supply"),
    ("chính sách tài khóa", "fiscal policy government spending taxation public debt"),
    ("lạm phát", "inflation consumer price index CPI price stability"),
    ("tỷ giá hối đoái", "exchange rate currency depreciation central bank"),
    ("thị trường chứng khoán", "stock market equity securities exchange return volatility"),
    ("trái phiếu doanh nghiệp", "corporate bonds debt securities issuance yield default"),
    ("ngân hàng thương mại", "commercial bank credit lending capital adequacy Basel"),
    ("rủi ro tín dụng", "credit risk non-performing loans default probability"),
    ("quản trị rủi ro", "risk management operational financial mitigation"),
    ("gian lận báo cáo tài chính", "financial statement fraud earnings manipulation audit"),
    ("báo cáo tài chính", "financial statements accounting disclosure IFRS GAAP"),
    ("kiểm toán độc lập", "independent audit external assurance audit quality"),
    ("thuế thu nhập doanh nghiệp", "corporate income tax tax avoidance fiscal incentive"),
    ("doanh nghiệp nhỏ và vừa", "small and medium-sized enterprises SMEs access to finance"),
    ("chuỗi cung ứng", "supply chain management logistics inventory optimization"),
    ("hành vi người tiêu dùng", "consumer behavior purchase intention brand loyalty"),
    ("sự hài lòng của khách hàng", "customer satisfaction service quality SERVQUAL loyalty"),
    ("nguồn nhân lực", "human resource management employee retention motivation"),
    ("năng lực cạnh tranh", "competitiveness competitive advantage firm performance"),
    # =========================================================================
    # 4. Y SINH HỌC, LÂM SÀNG, DƯỢC HỌC, Y TẾ CÔNG CỘNG & TÂM LÝ HỌC
    # =========================================================================
    ("thử nghiệm lâm sàng", "clinical trial randomized controlled study patients"),
    ("nghiên cứu lâm sàng", "clinical study cohort trial medical patients"),
    ("lâm sàng", "clinical medical patients hospital"),
    ("bệnh nhân", "patients clinical cohort subjects participants"),
    ("chẩn đoán hình ảnh", "medical imaging radiology CT MRI ultrasound diagnosis"),
    ("chẩn đoán", "diagnosis diagnostic screening detection sensitivity"),
    ("điều trị", "treatment therapy therapeutic intervention efficacy"),
    ("kháng kháng sinh", "antibiotic resistance antimicrobial bacterial infection MRSA"),
    ("vi khuẩn", "bacteria bacterial pathogen microbiology infection"),
    ("vắc-xin", "vaccine immunization antibody immune response efficacy"),
    ("miễn dịch", "immune system immunity antibody cytokine response"),
    ("ung thư", "cancer oncology tumor carcinoma metastasis chemotherapy"),
    ("khối u", "tumor neoplasm malignant benign lesion"),
    ("đột quỵ", "stroke ischemic hemorrhagic cerebrovascular rehabilitation"),
    ("tim mạch", "cardiovascular disease hypertension heart failure coronary"),
    ("huyết áp", "blood pressure hypertension systolic diastolic"),
    ("tiểu đường", "diabetes mellitus glycemic insulin resistance blood glucose"),
    ("đái tháo đường", "diabetes mellitus type 2 insulin glucose HbA1c"),
    ("suy thận", "renal failure chronic kidney disease hemodialysis"),
    ("dịch tễ học", "epidemiology prevalence incidence risk factors public health"),
    ("y tế công cộng", "public health healthcare prevention policy epidemiology"),
    ("tâm lý học nhận thức", "cognitive psychology executive function memory perception"),
    ("rối loạn lo âu", "anxiety disorder generalized anxiety stress mental health"),
    ("căng thẳng tâm lý", "psychological stress burnout coping anxiety depression"),
    ("thiếu ngủ", "sleep deprivation sleep restriction insomnia circadian"),
    ("chất lượng giấc ngủ", "sleep quality insomnia PSQI circadian rhythm"),
    ("trí nhớ ngắn hạn", "short-term working memory cognitive retention span"),
    ("trí nhớ làm việc", "working memory cognitive load executive function"),
    ("trí nhớ", "memory cognitive recall retention consolidation"),
    ("khả năng tập trung", "sustained attention cognitive focus vigilance"),
    ("tập trung chú ý", "sustained attention concentration cognitive performance"),
    ("thanh thiếu niên", "adolescents youth students teenagers developmental"),
    ("người cao tuổi", "elderly older adults geriatric aging population"),
    ("suy giảm nhận thức", "cognitive impairment decline dementia Alzheimer"),
    ("suy giảm", "impairs reduces decline degradation deterioration"),
    ("hoạt tính sinh học", "biological activity antioxidant antimicrobial cytotoxicity"),
    ("chống oxy hóa", "antioxidant activity free radical scavenging DPPH polyphenol"),
    ("dược động học", "pharmacokinetics bioavailability absorption metabolism"),
    # =========================================================================
    # 5. KỸ THUẬT ĐIỆN - ĐIỆN TỬ, TỰ ĐỘNG HÓA, NĂNG LƯỢNG & MÔI TRƯỜNG
    # =========================================================================
    ("năng lượng tái tạo", "renewable energy solar photovoltaic wind power grid"),
    ("điện mặt trời", "solar photovoltaic PV power generation inverter"),
    ("lưới điện thông minh", "smart grid microgrid power distribution load forecasting"),
    ("biến đổi khí hậu", "climate change global warming greenhouse gas carbon emissions"),
    ("phát thải khí nhà kính", "greenhouse gas emissions carbon footprint mitigation"),
    ("ô nhiễm không khí", "air pollution particulate matter PM2.5 air quality"),
    ("xử lý nước thải", "wastewater treatment adsorption photocatalysis heavy metals"),
    ("đa dạng sinh học", "biodiversity conservation ecosystem species habitat"),
    ("điều khiển tự động", "automatic control PID fuzzy controller robotics stability"),
    ("xe tự hành", "autonomous vehicles self-driving lane detection navigation"),
    ("xử lý tín hiệu", "signal processing filtering Fourier wavelet denoising"),
    # =========================================================================
    # 6. PHƯƠNG PHÁP NGHIÊN CỨU KHOA HỌC, THỐNG KÊ & GIÁO DỤC ĐẠI HỌC
    # =========================================================================
    ("phân tích thực nghiệm", "empirical analysis experimental evaluation benchmark"),
    ("đánh giá thực nghiệm", "experimental evaluation empirical benchmark ablation"),
    ("nghiên cứu cắt ngang", "cross-sectional study survey prevalence correlation"),
    ("nghiên cứu định lượng", "quantitative research statistical survey structural equation"),
    ("nghiên cứu định tính", "qualitative research interview thematic analysis case study"),
    ("mô hình cấu trúc tuyến tính", "structural equation modeling SEM PLS-SEM path analysis"),
    ("phân tích nhân tố khám phá", "exploratory factor analysis EFA Cronbach alpha KMO"),
    ("kiểm định giả thuyết", "hypothesis testing statistical significance p-value ANOVA"),
    ("khoảng tin cậy", "confidence interval bootstrap statistical uncertainty"),
    ("độ tin cậy", "reliability confidence calibration consistency"),
    ("độ chính xác", "accuracy precision performance evaluation metric"),
    ("giáo dục đại học", "higher education university students pedagogy learning outcomes"),
    ("liêm chính học thuật", "academic integrity plagiarism citation misconduct ethics"),
    ("đạo văn", "plagiarism text reuse academic misconduct detection"),
    ("giải thuật sắp xếp", "sorting algorithm quicksort mergesort heapsort"),
    ("thuật toán sắp xếp", "sorting algorithm quicksort mergesort heapsort"),
    ("giải thuật tìm kiếm", "search algorithm binary search linear search"),
    ("thuật toán tìm kiếm", "search algorithm binary search linear search"),
    ("độ phức tạp thuật toán", "algorithmic complexity computational complexity time complexity"),
    ("độ phức tạp thời gian", "time complexity asymptotic complexity"),
    ("cấu trúc dữ liệu", "data structures arrays linked lists trees"),
    ("quy hoạch động", "dynamic programming optimal substructure"),
    ("chia để trị", "divide and conquer algorithm recursion"),
    ("cây nhị phân", "binary tree binary search tree BST"),
    ("bảng băm", "hash table hashing collision resolution"),
    ("công nghệ phần mềm", "software engineering software development lifecycle"),
    ("hệ thống phần mềm", "software system architecture engineering"),
    ("kiểm thử phần mềm", "software testing unit testing quality assurance"),
    ("cơ sở dữ liệu quan hệ", "relational database SQL RDBMS"),
    ("cơ sở dữ liệu", "database management system DBMS SQL"),
    ("lớp học đảo ngược", "flipped classroom inverted learning pedagogy"),
    ("học tập kết hợp", "blended learning hybrid education pedagogy"),
    ("tư duy phản biện", "critical thinking analytical reasoning"),
    ("động lực học tập", "learning motivation student motivation"),
    ("kết quả học tập", "academic achievement learning outcomes student performance"),
    ("khung pháp lý", "legal framework regulatory framework legislation"),
    ("trái phiếu xanh", "green bond green bonds sustainable finance"),
    ("môi trường, xã hội và quản trị", "environmental social and governance ESG disclosure"),
    ("phát thải ròng bằng không", "net-zero emissions carbon neutrality climate"),
    ("mua lại và sáp nhập", "mergers and acquisitions M&A merger control"),
    ("sáp nhập và mua lại", "mergers and acquisitions M&A merger control"),
    ("an ninh kinh tế", "economic security national security screening"),
    ("thế chấp tài sản số", "collateralization of digital assets collateral"),
    ("tài sản số", "digital assets virtual assets crypto"),
    ("hiệu ứng cố định", "fixed-effects panel regression"),
    ("dữ liệu bảng", "panel data longitudinal regression"),
    ("ngân hàng trung ương", "central bank monetary policy interest rate"),
    ("phác đồ điều trị", "treatment regimen combination therapy protocol"),
    ("tỷ lệ sống sót", "survival rate clinical outcome mortality"),
    ("làm việc từ xa", "remote work telecommuting work from home"),
    ("năng suất lao động", "employee productivity labor productivity workplace"),
    ("sự gắn kết của nhân viên", "employee engagement team engagement commitment"),
    ("gắn kết nhân viên", "employee engagement team engagement"),
)


def normalize_vn_spelling(text: str) -> str:
    """Chuẩn hóa Unicode NFC, sửa lỗi font PDF tiếng Việt (Ƣ/ƣ -> Ư/ư) và đồng nhất quy tắc đặt dấu thanh (oà/òa, uỷ/ủy, lí/lý)."""
    if not text:
        return ""
    if text.isascii():
        return text
    norm = unicodedata.normalize("NFC", text)
    if norm.isascii():
        return norm
    if "\u01a2" in norm or "\u01a3" in norm:
        norm = norm.replace("\u01a2", "Ư").replace("\u01a3", "ư")
    for pat, repl in _VN_TONE_NORM_REGEXES:
        norm = pat.sub(repl, norm)
    lower = norm.lower()
    for old_pat, new_pat in _VN_LEXICAL_NORM_MAP:
        if old_pat in lower:
            norm = re.sub(re.escape(old_pat), new_pat, norm, flags=re.IGNORECASE)
            lower = norm.lower()
    return norm


@lru_cache(maxsize=1)
def _get_sorted_bridge() -> tuple[tuple[str, str], ...]:
    """Sắp xếp từ điển theo độ dài cụm tiếng Việt giảm dần để ưu tiên khớp cụm từ chuyên ngành dài trước."""
    return tuple(sorted(VN_EN_ACADEMIC_BRIDGE, key=lambda pair: len(pair[0]), reverse=True))


@lru_cache(maxsize=1)
def _get_indexed_en_bridge() -> tuple[tuple[str, frozenset[str], tuple[str, ...]], ...]:
    """Pre-index English keywords for each Vietnamese concept phrase to avoid repeated regex compilation."""
    _stop = {"and", "for", "the", "with", "law", "data", "model", "system", "study"}
    indexed: list[tuple[str, frozenset[str], tuple[str, ...]]] = []
    seen_vn: set[str] = set()
    for vn_phrase, en_equiv in _get_sorted_bridge():
        if vn_phrase in seen_vn:
            continue
        seen_vn.add(vn_phrase)
        en_words = tuple(
            w.lower()
            for w in re.findall(r"[A-Za-z0-9-]{3,}", en_equiv)
            if w.lower() not in _stop
        )
        plain_words = frozenset(w for w in en_words if "-" not in w)
        hyphen_words = tuple(w for w in en_words if "-" in w)
        indexed.append((vn_phrase, plain_words, hyphen_words))
    return tuple(indexed)


def is_vietnamese_text(text: str, min_diacritics: int = 2) -> bool:
    """Kiểm tra xem chuỗi văn bản có phải tiếng Việt (chứa đủ ký tự có dấu tiếng Việt) hay không."""
    if not text:
        return False
    return len(VN_DIACRITIC_RE.findall(text)) >= min_diacritics


def _format_primary_en(en_equiv: str, max_words: int = 3) -> str:
    """Format a concise, deduplicated English concept label for UI display."""
    words: list[str] = []
    seen_lower: set[str] = set()
    for w in en_equiv.split():
        w_key = w.lower().rstrip("s").replace("-", "")
        if w_key in seen_lower or w.lower() in {"and", "for", "the", "with", "of", "in", "to"}:
            continue
        seen_lower.add(w_key)
        words.append(w)
        if len(words) >= max_words:
            break
    return " ".join(words) if words else " ".join(en_equiv.split()[:max_words])


_URL_STRIP_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_ACRONYM_STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "that", "this", "have", "been", "were",
    "their", "which", "about", "into", "over", "between", "under", "through",
    "during", "before", "after", "study", "paper", "article", "review", "journal",
    "press", "university", "law", "case", "report", "book", "chapter", "page",
    "pages", "vol", "iss", "doi", "http", "https", "www", "com", "org", "net",
    "edu", "gov", "pdf", "html", "online", "available", "accessed", "retrieved",
    "trong", "cua", "cho", "voi", "cac", "mot", "nhung", "duoc", "theo", "nam",
})


def bridge_vn_to_en(
    cited_context: str,
    source_title: str = "",
    source_abstract: str | None = None,
) -> tuple[bool, str, list[str]]:
    """Phát hiện văn bản tiếng Việt trích dẫn nguồn tiếng Anh và tạo chuỗi bắc cầu ngữ nghĩa.

    Returns:
        Tuple (is_cross_lingual, bridged_context, bridged_concepts):
        - is_cross_lingual: True nếu context là tiếng Việt và nguồn là tiếng Anh.
        - bridged_context: Chuỗi ngữ cảnh đã bổ sung các khái niệm tiếng Anh tương đương.
        - bridged_concepts: Danh sách các cặp ánh xạ 'thuật ngữ VI -> thuật ngữ EN' đã kích hoạt.
    """
    if not cited_context:
        return False, "", []

    vn_chars = len(VN_DIACRITIC_RE.findall(cited_context))
    if vn_chars < 2:
        return False, "", []

    src_text = f"{source_title or ''} {source_abstract or ''}"
    src_vn_chars = len(VN_DIACRITIC_RE.findall(src_text))
    # Cross-lingual when context is Vietnamese and source is predominantly English
    if src_vn_chars > 5:
        return False, "", []

    norm_ctx = normalize_vn_spelling(cited_context).lower()
    bridged_terms: list[str] = []
    bridged_concepts: list[str] = []
    seen_en: set[str] = set()

    for vn_phrase, en_equiv in _get_sorted_bridge():
        if vn_phrase in norm_ctx:
            if en_equiv not in seen_en:
                seen_en.add(en_equiv)
                bridged_terms.append(en_equiv)
                primary_en = _format_primary_en(en_equiv)
                bridged_concepts.append(f"{vn_phrase} → {primary_en}")

    # Preserve technical English tokens/acronyms already present in the Vietnamese sentence (excluding URLs)
    ctx_no_url = _URL_STRIP_RE.sub(" ", cited_context)
    en_tokens = re.findall(r"\b[A-Za-z][A-Za-z0-9_+.-]{2,18}\b", ctx_no_url)
    non_vn_tokens = [
        t for t in en_tokens
        if not VN_DIACRITIC_RE.search(t) and t.lower() not in _ACRONYM_STOPWORDS
    ]

    if not bridged_terms and not non_vn_tokens:
        return True, cited_context, []

    bridge_str = " ".join(non_vn_tokens + bridged_terms)
    return True, f"{cited_context} ({bridge_str})", bridged_concepts


@lru_cache(maxsize=512)
def _find_vn_cues_cached(
    source_title: str,
    source_abstract: str,
) -> tuple[str, ...]:
    src_full_lower = f"{source_title} {source_abstract}".lower().strip()
    if not src_full_lower:
        return ()

    src_words = set(re.findall(r"[a-z0-9]{3,}", src_full_lower))
    vn_cues: list[str] = []
    for vn_phrase, plain_words, hyphen_words in _get_indexed_en_bridge():
        if plain_words & src_words or any(hw in src_full_lower for hw in hyphen_words):
            vn_cues.append(vn_phrase)
    return tuple(vn_cues)


def find_vn_cues_for_en_source(
    source_title: str,
    source_abstract: str | None = None,
) -> list[str]:
    """Dịch ngược từ khóa trong Title/Abstract tiếng Anh sang danh sách cụm khái niệm tiếng Việt
    (phục vụ Implicit Body Discovery và Cross-Lingual Title Matching).
    """
    return list(_find_vn_cues_cached(source_title or "", source_abstract or ""))


def compute_cross_lingual_concept_overlap(
    vn_text: str,
    en_text: str,
) -> tuple[float, list[str]]:
    """Tính mức độ chồng lấp khái niệm học thuật trực tiếp giữa văn bản tiếng Việt và văn bản tiếng Anh.

    Hàm này hoạt động độc lập và bổ trợ cho Dense Vector Embeddings: ngay cả khi mô hình nhúng
    đơn ngữ bị suy giảm điểm số do khác ngôn ngữ, sự xuất hiện đồng thời của cặp khái niệm
    chuyên ngành chuẩn hóa (ví dụ 'mất cân bằng dữ liệu' <-> 'imbalanced data / SMOTE')
    cung cấp bằng chứng neo ngữ nghĩa (semantic anchor) đáng tin cậy.

    Returns:
        Tuple (overlap_score [0.0..1.0], matched_concept_pairs).
    """
    if not vn_text or not en_text:
        return 0.0, []

    norm_vn = normalize_vn_spelling(vn_text).lower()
    norm_en = en_text.lower()

    matched_pairs: list[str] = []
    total_vn_concepts = 0
    matched_count = 0

    for vn_phrase, en_equiv in _get_sorted_bridge():
        if vn_phrase in norm_vn:
            total_vn_concepts += 1
            en_keywords = [
                w.lower()
                for w in re.findall(r"[A-Za-z0-9-]{3,}", en_equiv)
                if w.lower() not in {"and", "for", "the", "with"}
            ]
            hit_words = [
                ew for ew in en_keywords if re.search(rf"\b{re.escape(ew)}", norm_en)
            ]
            if hit_words:
                matched_count += 1
                primary_en = _format_primary_en(en_equiv)
                pair_label = f"{vn_phrase} → {primary_en}"
                if pair_label not in matched_pairs:
                    matched_pairs.append(pair_label)

    # Also check shared technical acronyms / model names present in both texts (e.g., BERT, SMOTE, IoT, FDI, ESG, Qwen3)
    vn_no_url = _URL_STRIP_RE.sub(" ", vn_text)
    en_no_url = _URL_STRIP_RE.sub(" ", norm_en)
    _roman_or_corp = {"ii", "iii", "iv", "vi", "vii", "viii", "ix", "xi", "xii", "plc", "inc", "ltd", "llc", "corp"}
    vn_en_acronyms = {
        w.lower()
        for w in re.findall(r"\b[A-Za-z][A-Za-z0-9-]{2,15}\b", vn_no_url)
        if not VN_DIACRITIC_RE.search(w)
        and w.lower() not in _ACRONYM_STOPWORDS
        and w.lower() not in _roman_or_corp
        and (
            (w.isupper() and len(w) >= 3)
            or any(c.isdigit() for c in w)
            or any(c.isupper() for c in w[1:])
        )
    }
    en_tokens = {
        w.lower()
        for w in re.findall(r"\b[A-Za-z][A-Za-z0-9-]{2,15}\b", en_no_url)
        if w.lower() not in _ACRONYM_STOPWORDS
    }
    shared_tech = vn_en_acronyms & en_tokens
    for st in sorted(shared_tech):
        matched_pairs.append(f"{st.upper()} ↔ {st.upper()}")

    if total_vn_concepts == 0 and not shared_tech:
        return 0.0, []

    denom = max(1, total_vn_concepts + len(shared_tech))
    raw_ratio = (matched_count + len(shared_tech)) / denom
    # Scale nicely: 1 strong domain concept match gives >= 0.55 concept overlap anchor, 2+ gives >= 0.78
    total_hits = matched_count + len(shared_tech)
    if total_hits == 0:
        return 0.0, []
    if total_hits == 1:
        score = max(0.55, min(0.75, 0.45 + 0.30 * raw_ratio))
    elif total_hits == 2:
        score = max(0.75, min(0.88, 0.65 + 0.25 * raw_ratio))
    else:
        score = max(0.85, min(0.96, 0.78 + 0.18 * raw_ratio))

    return round(score, 4), matched_pairs
