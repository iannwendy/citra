import { useTranslation } from 'react-i18next';
import { LiveCitationSandbox } from '@/components/LiveCitationSandbox';

/* ============================================================
   CITRA — Live Citation Sandbox Page (Scholarly Precision v2.0)
   Dedicated Interactive ACL Anthology & Instant Verification Studio
   ============================================================ */

export function SandboxPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  return (
    <div className="citra-cq-page-narrow w-full max-w-4xl mx-auto pb-6 transition-[max-width] duration-300" data-testid="sandbox-page">
      <LiveCitationSandbox lang={lang} />
    </div>
  );
}
