import { useTranslation } from 'react-i18next';
import { LiveCitationSandbox } from '@/components/LiveCitationSandbox';
import { resolveAcademicLang } from '@/lib/academicTaxonomy';

/* ============================================================
   CITRA — Live Citation Sandbox Page
   Dedicated Instant Citation Verification & Sample Paper Builder
   ============================================================ */

export function SandboxPage() {
  const { i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);

  return (
    <div className="citra-cq-page-narrow w-full max-w-4xl mx-auto pb-6 transition-[max-width] duration-300" data-testid="sandbox-page">
      <LiveCitationSandbox lang={lang} defaultMode="raw_paste" />
    </div>
  );
}
