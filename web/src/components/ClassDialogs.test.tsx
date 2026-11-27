import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '@/api/client';
import i18n from '@/i18n';
import {
  renderWithProviders,
  makeUser,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@/test-utils';
import { CreateClassDialog } from './CreateClassDialog';
import { AddStudentDialog } from './AddStudentDialog';
import { MyClassesPage } from '@/pages/MyClassesPage';

describe('CreateClassDialog i18n & behavior', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('renders English labels when language is en and creates a class', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    vi.spyOn(api, 'createClass').mockResolvedValue({
      id: 10,
      name: 'AI Ethics 101',
      description: 'Spring cohort',
      teacher_id: 2,
      teacher_username: 'lecturer1',
      join_code: 'ETH101',
      created_at: '2026-11-02T00:00:00Z',
      student_count: 0,
      essay_count: 0,
    });

    renderWithProviders(
      <CreateClassDialog open={true} onClose={onClose} onCreated={onCreated} />,
    );

    expect(screen.getByText('Create New Class')).toBeDefined();
    expect(screen.getByLabelText(/Class Name/i)).toBeDefined();
    expect(screen.getByLabelText(/Description \(optional\)/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Class Name/i), {
      target: { value: 'AI Ethics 101' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders Vietnamese labels when language is vi', async () => {
    await i18n.changeLanguage('vi');
    renderWithProviders(
      <CreateClassDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    expect(screen.getByText('Tạo lớp mới')).toBeDefined();
    expect(screen.getByLabelText(/Tên lớp/i)).toBeDefined();
    expect(screen.getByLabelText(/Mô tả \(tùy chọn\)/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Tạo' })).toBeDefined();
  });
});

describe('AddStudentDialog i18n & debounced Contract C1 search', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders in English, shows <2 chars hint, and debounces api.listStudents(q)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const listSpy = vi.spyOn(api, 'listStudents').mockImplementation(async (q?: string) => {
      if (q === 'ng') {
        return [
          {
            id: 5,
            username: 'nguyen_van_a',
            full_name: 'Nguyen Van A',
            email: 'a@example.com',
            is_active: true,
          },
          {
            id: 6,
            username: 'already_in',
            full_name: 'Nguyen Enrolled',
            email: 'enrolled@example.com',
            is_active: true,
          },
        ];
      }
      return [];
    });

    renderWithProviders(
      <AddStudentDialog
        open={true}
        classId={1}
        existingStudentIds={[6]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
    );

    expect(screen.getByText('Add Student')).toBeDefined();
    expect(screen.getByTestId('student-search-hint').textContent).toContain(
      'Type at least 2 characters to search all students',
    );
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith(undefined));

    const input = screen.getByLabelText('Search students');
    fireEvent.change(input, { target: { value: 'n' } });
    // Still < 2 chars, hint stays visible
    expect(screen.getByTestId('student-search-hint')).toBeDefined();

    fireEvent.change(input, { target: { value: 'ng' } });
    expect(screen.queryByTestId('student-search-hint')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('ng'));
    expect(await screen.findByText('nguyen_van_a')).toBeDefined();
    expect(screen.queryByText('already_in')).toBeNull();
  });

  it('renders in Vietnamese with localized hint and buttons', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listStudents').mockResolvedValue([
      {
        id: 8,
        username: 'sv01',
        full_name: 'Sinh Viên 01',
        email: 'sv01@example.com',
        is_active: true,
      },
    ]);

    renderWithProviders(
      <AddStudentDialog
        open={true}
        classId={1}
        existingStudentIds={[]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
    );

    expect(screen.getByText('Thêm sinh viên')).toBeDefined();
    expect(screen.getByTestId('student-search-hint').textContent).toContain(
      'Nhập ít nhất 2 ký tự để tìm sinh viên',
    );
    expect(await screen.findByRole('button', { name: 'Thêm' })).toBeDefined();
  });
});

describe('MyClassesPage create class button aria-label', () => {
  it('uses localized aria-label in English and Vietnamese', async () => {
    vi.spyOn(api, 'getTeacherDashboard').mockResolvedValue({
      total_classes: 0,
      total_students: 0,
      total_essays: 0,
      pending_reviews: 0,
      classes: [],
    });

    await i18n.changeLanguage('en');
    const { unmount } = renderWithProviders(<MyClassesPage />, {
      user: makeUser('teacher'),
    });
    expect(await screen.findByText('No classes yet.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create Class' })).toBeDefined();
    unmount();

    await i18n.changeLanguage('vi');
    renderWithProviders(<MyClassesPage />, {
      user: makeUser('teacher'),
    });
    expect(await screen.findByText('Chưa có lớp nào.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Tạo lớp' })).toBeDefined();
  });

  it('BUG-11 & BUG-50: AddStudentDialog portals with !mt-0, removes mixed English username in VI, and shows gentle prompt before typing', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listStudents').mockResolvedValue([]);

    renderWithProviders(
      <AddStudentDialog
        open={true}
        classId={1}
        existingStudentIds={[]}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    expect(backdrop.parentElement).toBe(document.body);
    expect(backdrop.className).toContain('!mt-0');

    const hint = screen.getByTestId('student-search-hint').textContent ?? '';
    expect(hint.toLowerCase()).not.toContain('username');

    const emptyState = await screen.findByTestId('student-search-empty-state');
    expect(emptyState.textContent).toContain(
      'Nhập tên hoặc email sinh viên để tìm kiếm...',
    );
    expect(emptyState.textContent).not.toContain('Không có sinh viên phù hợp');
  });

  it('BUG-22, BUG-50, BUG-55, BUG-56, BUG-57: filters teacher-owned classes out of Enrolled Classes, renders instructor full name, fixes EN singular grammar, and shows toast after creation', async () => {
    await i18n.changeLanguage('en');
    const ownClass = {
      id: 10,
      name: 'NLP Capstone',
      description: 'Senior seminar',
      join_code: 'CITRA-1001',
      teacher_id: 2,
      teacher_username: 'lecturer1',
      created_at: '2026-11-01T00:00:00Z',
      student_count: 1,
      essay_count: 1,
    };
    const peerClass = {
      id: 20,
      name: 'Peer Research Lab',
      description: null,
      join_code: 'PEER-2002',
      teacher_id: 99,
      teacher_username: 'dr_minh',
      teacher_full_name: 'Dr. Nguyen Minh',
      created_at: '2026-11-01T00:00:00Z',
      student_count: 5,
      essay_count: 2,
    };
    vi.spyOn(api, 'getTeacherDashboard').mockResolvedValue({
      total_classes: 1,
      total_students: 1,
      total_essays: 1,
      pending_reviews: 0,
      classes: [ownClass],
    });
    vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([ownClass, peerClass]);
    vi.spyOn(api, 'createClass').mockResolvedValue({
      ...ownClass,
      id: 30,
      name: 'New Cohort 2026',
      join_code: 'NEW-3030',
    });

    const { container } = renderWithProviders(<MyClassesPage />, {
      user: makeUser('teacher', 'pro', { id: 2 }),
    });

    expect(await screen.findByText('NLP Capstone')).toBeDefined();
    // EN singular grammar
    expect(container.textContent).toContain('1 ACTIVE CLASS');
    expect(container.textContent).not.toContain('1 ACTIVE CLASSES');
    expect(container.textContent).toContain('1 class');
    expect(container.textContent).not.toContain('1 classes');
    expect(screen.getByTestId('class-card-10').textContent).toContain('1student');
    expect(screen.getByTestId('class-card-10').textContent).toContain('1submission');

    // Enrolled Classes only shows peerClass (not ownClass), with instructor full name
    const enrolledSection = screen.getByTestId('enrolled-classes-section');
    expect(enrolledSection.textContent).toContain('Peer Research Lab');
    expect(enrolledSection.textContent).toContain('Dr. Nguyen Minh');
    expect(enrolledSection.textContent).not.toContain('NLP Capstone');

    // Create class -> portaled dialog with !mt-0 + success toast
    fireEvent.click(screen.getByRole('button', { name: 'Create Class' }));
    const createDialog = screen.getByRole('dialog');
    expect(createDialog.parentElement?.className).toContain('!mt-0');
    fireEvent.change(screen.getByLabelText(/Class Name/i), {
      target: { value: 'New Cohort 2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/Created class "New Cohort 2026"/)).toBeDefined();
  });
});
