# Teacher Role — Chi tiết hệ thống

## Tổng quan

Teacher là một trong 3 roles của hệ thống (`user` / `teacher` / `admin`). Role này cho phép giảng viên quản lý lớp học, theo dõi bài nộp của sinh viên, và override verdict (thay đổi kết quả kiểm tra trích dẫn) trên bài của sinh viên trong lớp.

---

## Mô hình dữ liệu

### Backend

```
User
├── id, username, email, password_hash
├── role: 'user' | 'teacher' | 'admin'
└── ...

Class
├── id
├── name              — tên lớp (VD: "CS101 - T3 K67")
├── course_code        — mã môn học (VD: "CS101")
├── teacher_id        — FK → User.id
├── teacher_username
├── student_count
├── essay_count
├── pending_reviews    — số bài cần xem xét (metadata_error / suspected_hallucination)
├── created_at
└── ...

ClassStudent
├── class_id, student_id
├── added_at
└── ...

Essay (đã có)
├── id, user_id, class_id?   ← thêm trường class_id
├── status, filename, ...
└── ...
```

### Frontend API types

```typescript
// web/src/api/client.ts

export interface Class {
  id: number;
  name: string;
  course_code: string;
  teacher_id: number;
  teacher_username: string;
  student_count: number;
  essay_count: number;
  pending_reviews: number;
  created_at: string;
}

export interface ClassStudent {
  student_id: number;
  username: string;
  essay_count: number;
  pending_reviews: number;
  added_at: string;
}

export interface ClassEssay {
  id: number;
  student_username: string;
  filename: string;
  submitted_at: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  verdict_counts: {
    verified: number;
    metadata_error: number;
    suspected_hallucination: number;
  };
  cis_score?: number;
}

export interface TeacherDashboard {
  total_classes: number;
  total_students: number;
  total_essays: number;
  pending_reviews: number;
  classes: Class[];
}
```

---

## Pages & Routes

```
/teacher/classes                          → MyClassesPage
/teacher/classes/:classId                 → ClassDetailPage
/teacher/reviews                           → PendingReviewsPage (xem tất cả bài cần duyệt)
```

### MyClassesPage

**Route:** `/teacher/classes`

Giảng viên thấy dashboard với:
- Số lớp, số sinh viên, số bài nộp, số bài cần xem xét
- Danh sách các lớp — click vào để vào ClassDetailPage
- Nút "Tạo lớp" — mở dialog tạo lớp mới

```
┌─────────────────────────────────────────────────────┐
│ 🎓 My Classes                          [+ Tạo lớp] │
│ Quản lý lớp học và theo dõi bài nộp.              │
├─────────────────────────────────────────────────────┤
│  Lớp: 3   SV: 45   Bài nộp: 120   Cần xem: 8    │
├─────────────────────────────────────────────────────┤
│ CS101 - T3 K67           15 SV  42 bài    3 ⚠️   │
│ IT204 - T5 K68           20 SV  55 bài    4 ⚠️   │
│ CS301 - T2 K66           10 SV  23 bài    1 ⚠️   │
└─────────────────────────────────────────────────────┘
```

### ClassDetailPage

**Route:** `/teacher/classes/:classId`

- Thông tin lớp (tên, mã môn, giảng viên)
- Tabs: **Students** | **Essays** | **Pending Reviews**
- **Students tab:** Danh sách sinh viên trong lớp, số bài nộp, số bài cần duyệt
- **Essays tab:** Tất cả bài nộp, filter theo status
- **Pending Reviews tab:** Chỉ hiện bài có `metadata_error` hoặc `suspected_hallucination`

Mỗi essay → click để xem chi tiết (EssayPage), có quyền override verdict.

### PendingReviewsPage

**Route:** `/teacher/reviews`

Tập hợp tất cả bài cần duyệt across all classes — giảng viên không phải vào từng lớp.

---

## Override Capability

**Cơ chế:** Teacher chỉ override được verdict của **bài trong lớp của mình**.

```typescript
// EssayPage — kiểm tra trước khi hiện override button
const canOverride =
  role === 'admin' ||
  (role === 'teacher' && essay.class_id && isTeacherOfClass(classId));
```

**Flow override:**
1. Teacher click nút Override trên một citation verdict
2. Chọn label mới (verified / metadata_error / unresolved)
3. Nhập lý do
4. Backend lưu override vào `override_log`
5. Frontend refetch lại report
6. AuditLog ghi nhận ai override, lúc nào, vì sao

**API:**
```
PATCH /api/citations/override
Body: {
  citation_id: string,
  new_label: 'verified' | 'metadata_error' | 'unresolved',
  reason: string,
  teacher_override: true
}
```

---

## Backend Endpoints

| Method | Endpoint | Mô tả | Access |
|--------|----------|--------|--------|
| GET | `/api/teacher/dashboard` | Tổng hợp stats + danh sách lớp | teacher, admin |
| GET | `/api/teacher/classes` | Danh sách lớp của teacher | teacher, admin |
| POST | `/api/teacher/classes` | Tạo lớp mới | teacher, admin |
| GET | `/api/teacher/classes/{id}` | Chi tiết lớp | teacher (chỉ lớp của mình), admin |
| PUT | `/api/teacher/classes/{id}` | Cập nhật lớp | teacher (chỉ lớp của mình), admin |
| DELETE | `/api/teacher/classes/{id}` | Xóa lớp | teacher (chỉ lớp của mình), admin |
| GET | `/api/teacher/classes/{id}/students` | Danh sách sinh viên | teacher, admin |
| POST | `/api/teacher/classes/{id}/students` | Thêm sinh viên vào lớp | teacher, admin |
| DELETE | `/api/teacher/classes/{id}/students/{studentId}` | Xóa sinh viên khỏi lớp | teacher, admin |
| GET | `/api/teacher/classes/{id}/essays` | Danh sách bài nộp | teacher, admin |
| GET | `/api/teacher/classes/{id}/pending-reviews` | Bài cần duyệt | teacher, admin |
| PATCH | `/api/citations/override` | Override verdict | teacher (chỉ bài trong lớp), admin |

---

## Capability-based routing

```typescript
// web/src/router.tsx

<ProtectedRoute requiredCapabilities={['view_class_history']}>
  <MyClassesPage />
</ProtectedRoute>
```

Capabilities được định nghĩa trong `useRole()` hook, đọc từ JWT payload:

```typescript
const CAPABILITIES: Record<string, string[]> = {
  admin:     ['*'],  // tất cả
  teacher:   ['view_class_history', 'override_verdict', 'view_class_reports'],
  user:      [],
};
```

---

## Batch Upload — Teacher

Khi teacher upload bài, hệ thống cho phép chọn lớp để gán:

```
┌─────────────────────────────────────────────────────┐
│ 📁 Drop PDF here                                   │
│ [BatchUploadPage]                                  │
├─────────────────────────────────────────────────────┤
│ Class: [CS101 - T3 K67        ▼]   ← dropdown    │
│         [IT204 - T5 K68        ▼]                  │
├─────────────────────────────────────────────────────┤
│ student1@example.edu   CS101.pdf  [Đang xử lý...]  │
│ student2@example.edu  essay.pdf   [✅ Done]       │
└─────────────────────────────────────────────────────┘
```

Teacher chỉ thấy lớp của mình trong dropdown.

---

## Security Model

```
User role: user
  → Upload bài, xem bài của mình, không override, không thấy lớp

User role: teacher
  → Thấy lớp của mình
  → Thấy bài nộp của sinh viên trong lớp
  → Override verdict bài trong lớp
  → Không thấy bài của teacher khác
  → Không thấy SystemHealth, AuditLog, AccountManagement

User role: admin
  → Tất cả quyền của teacher
  → Thấy tất cả lớp
  → Override bất kỳ verdict nào
  → Truy cập SystemHealth, AuditLog, AccountManagement
```

---

## So sánh User vs Teacher vs Admin

| Feature | User | Teacher | Admin |
|---------|------|--------|-------|
| Upload bài cá nhân | ✅ | ✅ | ✅ |
| Xem bài của mình | ✅ | ✅ | ✅ |
| Xem lớp học | — | ✅ | ✅ |
| Tạo lớp mới | — | ✅ | ✅ |
| Thêm sinh viên vào lớp | — | ✅ | ✅ |
| Xem bài sinh viên trong lớp | — | ✅ | ✅ |
| Override verdict (bài trong lớp) | — | ✅ | ✅ |
| Xem bài tất cả users | — | — | ✅ |
| Override verdict (bất kỳ bài) | — | — | ✅ |
| System Health | — | — | ✅ |
| Audit Log | — | — | ✅ |
| Account Management | — | — | ✅ |
