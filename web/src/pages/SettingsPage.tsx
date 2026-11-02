/**
 * Settings Page (Scholarly Precision shadcn/ui v2.0)
 * Central configuration hub for user preferences
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  Palette,
  Globe,
  Bell,
  Info,
  Check,
  ShieldCheck,
  Terminal,
  Sun,
  Moon,
  Monitor,
  CreditCard,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { api, type BillingTransactionItem, type SubscriptionSummary } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useTheme, type Theme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { APP_BUILD_DATE, APP_VERSION } from '@/version';

// ============================================================
// Types
// ============================================================

interface SettingsState {
  notifications: boolean;
}

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY_NOTIFICATIONS = 'settings_notifications';

// ============================================================
// Component
// ============================================================

export function SettingsPage(): JSX.Element {
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { user, refreshUser } = useAuth();
  const { planTier, isBasic, quota } = useRole();

  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [transactions, setTransactions] = useState<BillingTransactionItem[]>([]);
  const [billingLoading, setBillingLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    api
      .getMySubscription()
      .then((res) => {
        if (!active) return;
        setSubscription(res.subscription);
        setTransactions(res.transactions);
      })
      .catch(() => {
        // Fallback silently if unauthenticated in isolated unit tests
      });
    return () => {
      active = false;
    };
  }, [user]);

  const handleCancelSubscription = async (immediate: boolean = false) => {
    setBillingLoading(true);
    try {
      const res = await api.cancelSubscription(immediate);
      setSubscription(res.subscription);
      await refreshUser();
      toast.success(
        currentLang === 'vi' ? 'Đã cập nhật gói cước' : 'Subscription Updated',
        res.message,
        { category: 'STRIPE · BILLING' }
      );
    } catch (err) {
      toast.error(
        currentLang === 'vi' ? 'Lỗi' : 'Error',
        err instanceof Error ? err.message : 'Failed to cancel subscription',
        { category: 'STRIPE · BILLING' }
      );
    } finally {
      setBillingLoading(false);
    }
  };

  const handleReactivateSubscription = async () => {
    setBillingLoading(true);
    try {
      const res = await api.reactivateSubscription();
      setSubscription(res.subscription);
      await refreshUser();
      toast.success(
        currentLang === 'vi' ? 'Đã kích hoạt lại gia hạn' : 'Subscription Reactivated',
        res.message,
        { category: 'STRIPE · BILLING' }
      );
    } catch (err) {
      toast.error(
        currentLang === 'vi' ? 'Lỗi' : 'Error',
        err instanceof Error ? err.message : 'Failed to reactivate subscription',
        { category: 'STRIPE · BILLING' }
      );
    } finally {
      setBillingLoading(false);
    }
  };

  // Load saved settings
  const [settings, setSettings] = useState<SettingsState>(() => ({
    notifications: localStorage.getItem(STORAGE_KEY_NOTIFICATIONS) !== 'false',
  }));

  // Available themes
  const themeOptions: {
    value: Theme;
    label: string;
    icon: typeof Sun;
  }[] = [
    { value: 'light', label: t('settings.themeLight'), icon: Sun },
    { value: 'dark', label: t('settings.themeDark'), icon: Moon },
    { value: 'system', label: t('settings.themeSystem'), icon: Monitor },
  ];

  // Available languages (without flag emojis)
  const languages = [
    {
      code: 'vi',
      shortCode: 'VIE',
      localeTag: 'vi-VN',
      label: 'Tiếng Việt',
    },
    {
      code: 'en',
      shortCode: 'ENG',
      localeTag: 'en-US',
      label: 'English',
    },
  ];

  // Get current language from i18n (reactive) — no reload needed
  const currentLang = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];

  // Toggle setting
  const toggleSetting = (key: keyof SettingsState): void => {
    const newValue = !settings[key];
    localStorage.setItem(STORAGE_KEY_NOTIFICATIONS, String(newValue));
    setSettings((prev) => ({ ...prev, [key]: newValue }));

    toast.success(
      t('settings.settingsSaved'),
      newValue
        ? t('settings.notificationsEnabled')
        : t('settings.notificationsDisabled'),
      { force: true }
    );
  };

  // Change language — uses i18n.changeLanguage() for SPA navigation (no reload)
  const changeLanguage = (langCode: string): void => {
    void i18n.changeLanguage(langCode);
    localStorage.setItem('language', langCode);
    localStorage.setItem('i18nextLng', langCode);
    const fixedT = i18n.getFixedT(langCode);
    toast.success(
      fixedT('settings.languageUpdated'),
      langCode === 'vi' ? 'Tiếng Việt' : 'English'
    );
  };

  return (
    <div className="space-y-6 w-full max-w-5xl mx-auto pb-10">
      {/* Executive Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                {currentLang === 'vi'
                  ? 'CẤU HÌNH MÔI TRƯỜNG LÀM VIỆC'
                  : 'WORKSPACE ENVIRONMENT CONFIG'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/70 dark:border-emerald-800/70 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                v{APP_VERSION}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
                <Settings className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  {t('settings.title')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('settings.subtitle')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Appearance Section */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
              </div>
              <Separator orientation="vertical" className="h-4" />
              <Palette className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                {t('settings.appearance')}
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-400">01</span>
          </div>

          <div className="p-4 sm:p-6 flex-1 flex flex-col justify-between gap-4">
            <div className="flex items-center justify-between gap-2">
              <Label className="input-label mb-0">{t('settings.theme')}</Label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('settings.themeDescription')}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {themeOptions.map((opt) => {
                const Icon = opt.icon;
                const isActive = theme === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTheme(opt.value)}
                    aria-pressed={isActive}
                    className={`group relative flex flex-col items-center justify-center gap-2 p-3 rounded-xl border text-center transform-gpu transition-[transform,border-color,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.968] cursor-pointer select-none ${
                      isActive
                        ? 'border-indigo-500/90 dark:border-indigo-500/80 bg-gradient-to-br from-indigo-50/90 via-indigo-50/40 to-white dark:from-indigo-950/70 dark:via-indigo-950/30 dark:to-slate-900 ring-2 ring-indigo-500/15 dark:ring-indigo-400/20 shadow-xs'
                        : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800/60 hover:border-indigo-200 dark:hover:border-indigo-800/80 hover:shadow-xs'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200 ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-xs shadow-indigo-500/30 dark:bg-indigo-500 dark:text-white'
                          : 'bg-slate-100 text-slate-600 border border-slate-200/80 group-hover:bg-indigo-50 group-hover:text-indigo-600 group-hover:border-indigo-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700/80 dark:group-hover:bg-indigo-950/70 dark:group-hover:text-indigo-300 dark:group-hover:border-indigo-800/70'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span
                      className={`font-semibold text-xs leading-tight truncate ${
                        isActive
                          ? 'text-indigo-950 dark:text-indigo-100'
                          : 'text-slate-700 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-slate-100'
                      }`}
                    >
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Language Section */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
              </div>
              <Separator orientation="vertical" className="h-4" />
              <Globe className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                {t('settings.language')}
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-400">02</span>
          </div>

          <div className="p-4 sm:p-6 flex-1 flex flex-col justify-between gap-4">
            <div className="flex items-center justify-between gap-2">
              <Label className="input-label mb-0">{t('settings.language')}</Label>
              <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                vi-VN / en-US
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {languages.map((lang) => {
                const isActive = currentLang === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => changeLanguage(lang.code)}
                    aria-pressed={isActive}
                    className={`group relative flex items-center justify-between gap-2.5 sm:gap-3 p-3 sm:p-3.5 rounded-xl border text-left transform-gpu transition-[transform,border-color,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.972] cursor-pointer select-none ${
                      isActive
                        ? 'border-indigo-500/90 dark:border-indigo-500/80 bg-gradient-to-br from-indigo-50/90 via-indigo-50/40 to-white dark:from-indigo-950/70 dark:via-indigo-950/30 dark:to-slate-900 ring-2 ring-indigo-500/15 dark:ring-indigo-400/20 shadow-xs'
                        : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800/60 hover:border-indigo-200 dark:hover:border-indigo-800/80 hover:shadow-xs'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                      <span
                        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 font-mono text-[11px] font-bold tracking-wider transition-colors duration-200 ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-xs shadow-indigo-500/30 dark:bg-indigo-500 dark:text-white'
                            : 'bg-slate-100 text-slate-600 border border-slate-200/80 group-hover:bg-indigo-50 group-hover:text-indigo-600 group-hover:border-indigo-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700/80 dark:group-hover:bg-indigo-950/70 dark:group-hover:text-indigo-300 dark:group-hover:border-indigo-800/70'
                        }`}
                      >
                        {lang.shortCode}
                      </span>

                      <div className="min-w-0">
                        <span
                          className={`block font-semibold text-sm leading-tight truncate ${
                            isActive
                              ? 'text-indigo-950 dark:text-indigo-100'
                              : 'text-slate-700 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-slate-100'
                          }`}
                        >
                          {lang.label}
                        </span>
                        <span
                          className={`block text-[11px] font-mono mt-0.5 truncate ${
                            isActive
                              ? 'text-indigo-600/80 dark:text-indigo-300/80'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {lang.localeTag}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${
                        isActive
                          ? 'bg-indigo-600 dark:bg-indigo-500 text-white shadow-2xs'
                          : 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 group-hover:border-indigo-300 dark:group-hover:border-indigo-700'
                      }`}
                    >
                      {isActive && <Check className="w-3 h-3 stroke-[2.5]" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Notifications Section */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Bell className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.notifications')}
            </h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
            <Terminal className="w-3 h-3" />
            workspace_preferences.json
          </span>
        </div>

        <div className="p-4 sm:p-6">
          <ToggleSetting
            label={t('settings.enableNotifications')}
            description={t('settings.enableNotificationsDesc')}
            checked={settings.notifications}
            onChange={() => toggleSetting('notifications')}
          />
        </div>
      </div>

      {/* Subscription & Billing Section (v2.2) */}
      <div
        className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
        data-testid="settings-billing-section"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <CreditCard className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              {currentLang === 'vi'
                ? 'Gói Cước & Thanh Toán Stripe'
                : 'Subscription & Stripe Billing'}
            </h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400">04</span>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-mono uppercase text-slate-500">
                  {currentLang === 'vi' ? 'Gói hiện tại:' : 'Active Tier:'}
                </span>
                <Badge
                  data-testid="settings-active-tier-badge"
                  className={
                    planTier === 'ultra'
                      ? 'bg-violet-600 text-white font-mono uppercase'
                      : planTier === 'pro'
                        ? 'bg-indigo-600 text-white font-mono uppercase'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-mono uppercase'
                  }
                >
                  CITRA {planTier.toUpperCase()}
                </Badge>
                {subscription?.billing_cycle && (
                  <Badge variant="outline" className="font-mono text-[11px] uppercase">
                    {subscription.billing_cycle}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                {currentLang === 'vi'
                  ? `Hạn mức tháng: Đã dùng ${quota.monthly_uploads_used}/${quota.monthly_uploads_limit} tài liệu · Tối đa ${quota.max_file_size_mb} MB & ${quota.max_pages_per_pdf} trang/PDF`
                  : `Monthly Quota: ${quota.monthly_uploads_used}/${quota.monthly_uploads_limit} checks used · Max ${quota.max_file_size_mb} MB & ${quota.max_pages_per_pdf} pages/PDF`}
              </p>
              {subscription?.cancel_at_period_end && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  {currentLang === 'vi'
                    ? 'Đã tắt tự động gia hạn. Bạn vẫn giữ quyền lợi gói đến hết chu kỳ hiện tại.'
                    : 'Auto-renewal is turned off. Paid benefits remain active until the end of the billing cycle.'}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                asChild
                size="sm"
                data-testid="settings-upgrade-plan-btn"
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
              >
                <Link to="/pricing">
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  {isBasic
                    ? currentLang === 'vi'
                      ? 'Nâng cấp Pro / Ultra'
                      : 'Upgrade to Pro / Ultra'
                    : currentLang === 'vi'
                      ? 'Đổi gói / Chu kỳ'
                      : 'Change Plan / Cycle'}
                </Link>
              </Button>

              {!isBasic && user?.role !== 'admin' && (
                <>
                  {subscription?.cancel_at_period_end ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={billingLoading}
                      data-testid="settings-reactivate-sub-btn"
                      onClick={handleReactivateSubscription}
                      className="rounded-xl text-xs"
                    >
                      {billingLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                      {currentLang === 'vi' ? 'Bật lại gia hạn' : 'Reactivate Auto-Renew'}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={billingLoading}
                      data-testid="settings-cancel-sub-btn"
                      onClick={() => handleCancelSubscription(false)}
                      className="rounded-xl text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30"
                    >
                      {billingLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                      {currentLang === 'vi' ? 'Hủy gia hạn' : 'Cancel Auto-Renew'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Transaction History */}
          {transactions.length > 0 && (
            <div className="space-y-2" data-testid="settings-transactions-list">
              <p className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                {currentLang === 'vi'
                  ? 'Lịch sử thanh toán Stripe gần đây'
                  : 'Recent Stripe Billing Transactions'}
              </p>
              <div className="divide-y divide-slate-200/70 dark:divide-slate-800 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden text-xs">
                {transactions.slice(0, 5).map((tx) => (
                  <div
                    key={tx.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-2 bg-white dark:bg-slate-900 flex-wrap"
                  >
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <Badge
                        variant={tx.status === 'succeeded' ? 'default' : 'secondary'}
                        className="font-mono text-[10px] uppercase"
                      >
                        {tx.status}
                      </Badge>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        CITRA {tx.plan_name} ({tx.billing_cycle})
                      </span>
                      {tx.promo_code && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[10px] font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                          {tx.promo_code}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-slate-600 dark:text-slate-400">
                      <span>
                        {tx.payment_method === 'apple_pay'
                          ? `APPLE PAY •••• ${tx.card_last4 || '4242'}`
                          : tx.payment_method === 'google_pay'
                            ? `GOOGLE PAY •••• ${tx.card_last4 || '4242'}`
                            : `${(tx.card_brand || 'visa').toUpperCase()} •••• ${tx.card_last4 || '4242'}`}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white">
                        ${tx.amount_usd.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* About Section */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Info className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.about')}
            </h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400">05</span>
        </div>

        <div className="p-6 space-y-3">
          <InfoRow label={t('settings.version')} value={APP_VERSION} />
          <InfoRow
            label={t('settings.buildDate')}
            value={APP_BUILD_DATE}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

interface ToggleSettingProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}

function ToggleSetting({
  label,
  description,
  checked,
  onChange,
}: ToggleSettingProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">
          {label}
        </p>
        {description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {description}
          </p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
}

function InfoRow({ label, value }: InfoRowProps): JSX.Element {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600 dark:text-slate-400">{label}</span>
      <span className="font-medium font-mono text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
        {value}
      </span>
    </div>
  );
}

export default SettingsPage;
