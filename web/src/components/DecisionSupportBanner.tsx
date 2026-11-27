import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { type AcademicLang, resolveAcademicLang } from '@/lib/academicTaxonomy';

export interface DecisionSupportBannerProps {
  variant?: 'compact' | 'card';
  lang?: AcademicLang;
  className?: string;
}

const COPY: Record<
  AcademicLang,
  { title: string; compactText: string; cardText: string }
> = {
  vi: {
    title: 'Công cụ hỗ trợ rà soát học thuật',
    compactText:
      'CITRA hỗ trợ đối chiếu trích dẫn — không tự động kết luận gian lận học thuật. Quyết định cuối cùng thuộc về giảng viên và người đánh giá.',
    cardText:
      'Kết quả kiểm tra được tổng hợp từ các thư viện học thuật công khai nhằm hỗ trợ rà soát. Nhãn "Không tìm thấy nguồn" chỉ là gợi ý cần kiểm tra lại bản gốc — không đồng nghĩa tài liệu không có thật hay gian lận học thuật. Quyết định cuối cùng luôn thuộc về giảng viên và chuyên gia.',
  },
  en: {
    title: 'Academic Decision-Support Notice',
    compactText:
      'CITRA assists human citation review — it does not conclude academic misconduct. Final judgment always rests with instructors and reviewers.',
    cardText:
      'Verification results are compiled from public academic libraries to assist human review. A "Source Not Found" label is a review prompt to double-check the original source — not proof of fabrication or misconduct. Final judgment always rests with instructors and human reviewers.',
  },
};

export function DecisionSupportBanner({
  variant = 'card',
  lang,
  className,
}: DecisionSupportBannerProps) {
  const { i18n } = useTranslation();
  const resolvedLang = lang ?? resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const copy = COPY[resolvedLang];

  if (variant === 'compact') {
    return (
      <div
        role="note"
        data-testid="decision-support-banner"
        className={cn(
          'flex items-start gap-2.5 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/70 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed',
          className,
        )}
      >
        <ShieldCheck
          className="h-4 w-4 text-slate-700 dark:text-slate-300 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <p className="min-w-0">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {copy.title}:{' '}
          </span>
          {copy.compactText}
        </p>
      </div>
    );
  }

  return (
    <div
      role="note"
      data-testid="decision-support-banner"
      className={cn(
        'rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/70 p-4 flex items-start gap-3.5',
        className,
      )}
    >
      <div className="h-8 w-8 rounded-lg bg-slate-200/70 dark:bg-slate-800 border border-slate-300/60 dark:border-slate-700 flex items-center justify-center text-slate-800 dark:text-slate-200 shrink-0 mt-0.5">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="space-y-1 min-w-0">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
          {copy.title}
        </h4>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {copy.cardText}
        </p>
      </div>
    </div>
  );
}
