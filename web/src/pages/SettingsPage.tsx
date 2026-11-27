/**
 * CITRA — Settings Page
 * Central configuration hub for user preferences, billing, API keys & data rights
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  Palette,
  Globe,
  Bell,
  Info,
  Check,
  ShieldCheck,
  Sun,
  Moon,
  Monitor,
  CreditCard,
  Sparkles,
  Loader2,
  KeyRound,
  Copy,
  Trash2,
  Plus,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';
import {
  api,
  type ApiKeyItem,
  type BillingTransactionItem,
  type CreatedApiKeyResponse,
  type SubscriptionSummary,
} from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useModalA11y } from '@/hooks/useModalA11y';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { getQuotaView, isUnlimitedValue } from '@/lib/quotaDisplay';
import {
  formatLocalizedDate,
  formatLocalizedDateTime,
  formatUserError,
  resolveAcademicLang,
} from '@/lib/academicTaxonomy';
import { useTheme, type Theme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  IconSwap,
  TextMorph,
  useErrorShake,
} from '@/components/ui/transitions';
import { APP_BUILD_DATE, APP_VERSION } from '@/version';

// ============================================================
// Types & Helpers
// ============================================================

interface SettingsState {
  notifications: boolean;
}

const STORAGE_KEY_NOTIFICATIONS = 'settings_notifications';
const USD_TO_VND_RATE = 25000;

function formatBillingCycleLabel(
  cycle: string | null | undefined,
  lang: 'vi' | 'en',
): string {
  const norm = String(cycle ?? '').trim().toLowerCase();
  if (norm === 'annual') return lang === 'vi' ? 'Theo năm' : 'Annual';
  if (norm === 'monthly') return lang === 'vi' ? 'Theo tháng' : 'Monthly';
  return cycle ?? '';
}

function formatTransactionStatusLabel(
  status: string | null | undefined,
  lang: 'vi' | 'en',
): string {
  const norm = String(status ?? '').trim().toLowerCase();
  if (norm === 'succeeded') return lang === 'vi' ? 'Thành công' : 'Paid';
  if (norm === 'pending') return lang === 'vi' ? 'Đang xử lý' : 'Pending';
  if (norm === 'failed') return lang === 'vi' ? 'Thất bại' : 'Failed';
  return status ?? '';
}

function formatPaymentMethodSummary(
  tx: BillingTransactionItem,
  lang: 'vi' | 'en',
): string {
  const last4 = tx.card_last4 ? ` •••• ${tx.card_last4}` : '';
  if (tx.payment_method === 'vnpay') {
    const bank = (tx.vnp_bank_code || tx.card_brand || '').toUpperCase();
    return bank ? `VNPay · ${bank}${last4}` : `VNPay${last4}`;
  }
  if (tx.payment_method === 'apple_pay') {
    return `Apple Pay${last4}`;
  }
  if (tx.payment_method === 'google_pay') {
    return `Google Pay${last4}`;
  }
  if (tx.card_brand) {
    return `${tx.card_brand.toUpperCase()}${last4}`;
  }
  return `${lang === 'vi' ? 'Thẻ thanh toán' : 'Card'}${last4}`;
}

function formatTransactionAmount(
  tx: BillingTransactionItem,
  lang: 'vi' | 'en',
): string {
  const usdFormatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(tx.amount_usd);

  if (typeof tx.amount_vnd === 'number' && tx.amount_vnd > 0) {
    const vndFormatted = `${Math.round(tx.amount_vnd)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
    return `${vndFormatted} (${usdFormatted})`;
  }

  if (lang === 'vi' && tx.amount_usd > 0) {
    const approxVnd = `${Math.round(tx.amount_usd * USD_TO_VND_RATE)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
    return `${usdFormatted} (~${approxVnd})`;
  }

  return usdFormatted;
}

// ============================================================
// Component
// ============================================================

export function SettingsPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { user, refreshUser, logout } = useAuth();
  const { planTier, isBasic, quota, isAdmin } = useRole();

  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const currentLang = lang;

  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(
    null,
  );
  const [transactions, setTransactions] = useState<BillingTransactionItem[]>(
    [],
  );
  const [billingLoading, setBillingLoading] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Self-service account deletion & consent withdrawal (DLCN-03)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmUsername, setDeleteConfirmUsername] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const { isShaking: isDeleteShaking, triggerError: triggerDeleteShake } =
    useErrorShake();

  const userHasPassword = user?.has_password !== false;
  const canSubmitDelete = userHasPassword
    ? deletePassword.trim().length > 0
    : deleteConfirmUsername.trim() === user?.username;

  const deleteDialog = useModalA11y<HTMLDivElement>(
    deleteModalOpen && Boolean(user),
    () => setDeleteModalOpen(false),
    { disableEscape: deletingAccount },
  );

  const handleDeleteMyAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || deletingAccount) return;
    setDeleteError('');

    if (userHasPassword) {
      if (!deletePassword.trim()) {
        triggerDeleteShake();
        setDeleteError(
          lang === 'vi'
            ? 'Vui lòng nhập mật khẩu hiện tại để xác nhận.'
            : 'Please enter your current password to confirm.',
        );
        return;
      }
    } else {
      if (deleteConfirmUsername.trim() !== user.username) {
        triggerDeleteShake();
        setDeleteError(
          lang === 'vi'
            ? `Vui lòng nhập chính xác tên đăng nhập "${user.username}".`
            : `Please type your exact username "${user.username}".`,
        );
        return;
      }
    }

    setDeletingAccount(true);
    try {
      await api.deleteMyAccount(
        userHasPassword
          ? { current_password: deletePassword }
          : { confirm_username: deleteConfirmUsername.trim() },
      );
      setDeleteModalOpen(false);
      await logout();
      navigate('/');
    } catch (err) {
      triggerDeleteShake();
      setDeleteError(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể xóa tài khoản. Vui lòng kiểm tra lại thông tin xác nhận.'
            : 'Could not delete account. Please check your confirmation input.',
        ),
      );
    } finally {
      setDeletingAccount(false);
    }
  };

  // Personal Developer API Keys (X-API-Key, Task 6.4)
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] =
    useState<CreatedApiKeyResponse | null>(null);
  const [copiedRawKey, setCopiedRawKey] = useState(false);
  const [apiSectionOpen, setApiSectionOpen] = useState<boolean>(() => Boolean(isAdmin));
  const [apiSectionTouched, setApiSectionTouched] = useState<boolean>(false);

  const canManageApiKeys =
    !isBasic || isAdmin || user?.role === 'teacher' || user?.role === 'admin';

  useEffect(() => {
    if (apiSectionTouched) return;
    if (isAdmin || apiKeys.length > 0) {
      setApiSectionOpen(true);
    }
  }, [isAdmin, apiKeys.length, apiSectionTouched]);

  // Smoothly scroll to Delete Account section when navigated via /settings#delete-account-section
  useEffect(() => {
    if (location.hash === '#delete-account-section') {
      const target = document.getElementById('delete-account-section');
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [location.hash]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    api
      .getMySubscription()
      .then((res) => {
        if (!active) return;
        setSubscription(res?.subscription ?? null);
        setTransactions(
          Array.isArray(res?.transactions) ? res.transactions : [],
        );
      })
      .catch(() => {
        // Fallback silently if unauthenticated in isolated unit tests
      });
    if (typeof api.listApiKeys === 'function') {
      api
        .listApiKeys()
        .then((keys) => {
          if (!active) return;
          setApiKeys(Array.isArray(keys) ? keys : []);
        })
        .catch(() => {
          // Ignore in isolated tests
        });
    }
    return () => {
      active = false;
    };
  }, [user]);

  const handleCreateApiKey = async () => {
    const trimmed = newKeyName.trim();
    if (!trimmed || creatingKey) return;
    setCreatingKey(true);
    try {
      const created = await api.createApiKey(trimmed);
      setNewlyCreatedKey(created);
      setCopiedRawKey(false);
      setNewKeyName('');
      setApiKeys((prev) => [created, ...prev]);
      toast.success(
        lang === 'vi' ? 'Đã tạo khóa API mới' : 'API Key Created',
        `${created.name} (${created.key_prefix}…)`,
      );
    } catch (err) {
      toast.error(
        lang === 'vi' ? 'Không thể tạo khóa API' : 'Failed to create API key',
        formatUserError(err, lang),
      );
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeApiKey = async (keyId: number) => {
    try {
      await api.revokeApiKey(keyId);
      setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
      if (newlyCreatedKey?.id === keyId) {
        setNewlyCreatedKey(null);
      }
      toast.success(lang === 'vi' ? 'Đã thu hồi khóa API' : 'API Key Revoked');
    } catch (err) {
      toast.error(
        lang === 'vi'
          ? 'Không thể thu hồi khóa API'
          : 'Failed to revoke API key',
        formatUserError(err, lang),
      );
    }
  };

  const handleCopyRawKey = async () => {
    if (!newlyCreatedKey?.raw_key) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(newlyCreatedKey.raw_key);
      }
    } catch {
      // Clipboard fallback
    }
    setCopiedRawKey(true);
    setTimeout(() => setCopiedRawKey(false), 2000);
  };

  const handleCancelSubscription = async (immediate: boolean = false) => {
    setBillingLoading(true);
    try {
      const res = await api.cancelSubscription(immediate);
      setSubscription(res.subscription);
      await refreshUser();
      toast.success(
        lang === 'vi' ? 'Đã cập nhật gói dịch vụ' : 'Subscription Updated',
        lang === 'vi'
          ? 'Tự động gia hạn đã được tắt.'
          : 'Auto-renewal has been turned off.',
      );
    } catch (err) {
      toast.error(
        lang === 'vi' ? 'Không thể hủy gia hạn' : 'Could not update plan',
        formatUserError(err, lang),
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
        lang === 'vi' ? 'Đã bật lại gia hạn' : 'Subscription Reactivated',
        lang === 'vi'
          ? 'Tự động gia hạn đã được bật lại cho gói của bạn.'
          : 'Auto-renewal is active again for your plan.',
      );
    } catch (err) {
      toast.error(
        lang === 'vi' ? 'Không thể bật lại gia hạn' : 'Could not update plan',
        formatUserError(err, lang),
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

  // Available languages (without flag emojis or raw locale codes)
  const languages = [
    {
      code: 'vi',
      shortCode: 'VI',
      label: 'Tiếng Việt',
    },
    {
      code: 'en',
      shortCode: 'EN',
      label: 'English',
    },
  ];

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
      { force: true },
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
      langCode === 'vi' ? 'Tiếng Việt' : 'English',
    );
  };

  const deleteModalMarkup =
    deleteModalOpen && user ? (
      <div
        data-testid="delete-account-modal"
        className="!mt-0 fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-[fadeIn_180ms_ease-out]"
      >
        <div
          {...deleteDialog.dialogProps}
          role="dialog"
          aria-modal="true"
          aria-describedby={deleteDialog.descriptionId}
          data-testid="delete-account-dialog-panel"
          className="t-modal is-open w-full max-w-md rounded-2xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden outline-none"
        >
          <div className="h-1.5 w-full bg-gradient-to-r from-red-600 via-red-500 to-amber-500" />
          <form onSubmit={handleDeleteMyAccount} className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 shrink-0 animate-icon-pop">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3
                  id={deleteDialog.titleId}
                  className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
                >
                  {t('privacyCompliance.deleteModalTitle')}
                </h3>
                <p
                  id={deleteDialog.descriptionId}
                  className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed"
                >
                  {t('privacyCompliance.deleteAccountZoneDesc')}
                </p>
              </div>
            </div>

            {deleteError && (
              <div
                role="alert"
                className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3 py-2 text-xs text-red-700 dark:text-red-300 font-medium animate-error-shake"
              >
                {deleteError}
              </div>
            )}

            {userHasPassword ? (
              <div className="space-y-1.5">
                <Label
                  htmlFor="delete-account-password"
                  className="text-xs font-semibold"
                >
                  {t('privacyCompliance.deleteModalPasswordLabel')}
                </Label>
                <input
                  id="delete-account-password"
                  type="password"
                  value={deletePassword}
                  onChange={(e) => {
                    setDeletePassword(e.target.value);
                    if (deleteError) setDeleteError('');
                  }}
                  placeholder={t(
                    'privacyCompliance.deleteModalPasswordPlaceholder',
                  )}
                  data-testid="delete-account-password-input"
                  autoComplete="current-password"
                  className={`t-input ${deleteError ? 'is-error' : ''} ${isDeleteShaking ? 'is-shaking' : ''} w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500`}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label
                  htmlFor="delete-account-username"
                  className="text-xs font-semibold"
                >
                  {t('privacyCompliance.deleteModalUsernameLabel', {
                    username: user.username,
                  })}
                </Label>
                <input
                  id="delete-account-username"
                  type="text"
                  value={deleteConfirmUsername}
                  onChange={(e) => {
                    setDeleteConfirmUsername(e.target.value);
                    if (deleteError) setDeleteError('');
                  }}
                  placeholder={t(
                    'privacyCompliance.deleteModalUsernamePlaceholder',
                  )}
                  data-testid="delete-account-username-input"
                  className={`t-input ${deleteError ? 'is-error' : ''} ${isDeleteShaking ? 'is-shaking' : ''} w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500`}
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={deletingAccount}
                onClick={() => setDeleteModalOpen(false)}
                className="rounded-xl text-xs"
              >
                {t('privacyCompliance.deleteModalCancelBtn')}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={deletingAccount || !canSubmitDelete}
                data-testid="delete-account-confirm-btn"
                className="rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingAccount ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    <span>{lang === 'vi' ? 'Đang xóa...' : 'Deleting...'}</span>
                  </>
                ) : (
                  t('privacyCompliance.deleteModalConfirmBtn')
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    ) : null;

  return (
    <div className="citra-cq-page-wide space-y-6 w-full max-w-5xl mx-auto pb-10 transition-[max-width] duration-300">
      {/* Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
              <Settings className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="min-w-0">
              <h1 className="font-solva-serif font-normal text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-slate-100">
                {t('settings.title')}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {t('settings.subtitle')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 01 Appearance & 02 Language — stack cleanly below xl so 1024px & 375px never truncate */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Appearance Section */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2.5 min-w-0">
              <Palette className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                {t('settings.appearance')}
              </h2>
            </div>
          </div>

          <div className="p-4 sm:p-6 flex-1 flex flex-col justify-between gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="input-label mb-0">{t('settings.theme')}</Label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('settings.themeDescription')}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
              {themeOptions.map((opt) => {
                const Icon = opt.icon;
                const isActive = theme === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTheme(opt.value)}
                    aria-pressed={isActive}
                    className={`group relative flex flex-col items-center justify-center gap-2 p-2.5 sm:p-3 rounded-xl border text-center min-w-0 transform-gpu transition-[transform,border-color,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.968] cursor-pointer select-none ${
                      isActive
                        ? 'border-indigo-500/90 dark:border-indigo-500/80 bg-gradient-to-br from-indigo-50/90 via-indigo-50/40 to-white dark:from-indigo-950/70 dark:via-indigo-950/30 dark:to-slate-900 ring-2 ring-indigo-500/15 dark:ring-indigo-400/20 shadow-sm'
                        : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800/60 hover:border-indigo-200 dark:hover:border-indigo-800/80 hover:shadow-sm'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200 ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 dark:bg-indigo-500 dark:text-white'
                          : 'bg-slate-100 text-slate-600 border border-slate-200/80 group-hover:bg-indigo-50 group-hover:text-indigo-600 group-hover:border-indigo-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700/80 dark:group-hover:bg-indigo-950/70 dark:group-hover:text-indigo-300 dark:group-hover:border-indigo-800/70'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span
                      className={`font-semibold text-xs leading-tight whitespace-nowrap ${
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
          <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2.5 min-w-0">
              <Globe className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                {t('settings.language')}
              </h2>
            </div>
          </div>

          <div className="p-4 sm:p-6 flex-1 flex flex-col justify-between gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="input-label mb-0">
                {t('settings.language')}
              </Label>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'vi'
                  ? 'Chọn ngôn ngữ hiển thị giao diện'
                  : 'Choose your display language'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {languages.map((langOpt) => {
                const isActive = currentLang === langOpt.code;
                return (
                  <button
                    key={langOpt.code}
                    type="button"
                    onClick={() => changeLanguage(langOpt.code)}
                    aria-pressed={isActive}
                    className={`group relative flex items-center justify-between gap-3 p-3.5 rounded-xl border text-left min-w-0 w-full transform-gpu transition-[transform,border-color,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.972] cursor-pointer select-none ${
                      isActive
                        ? 'border-indigo-500/90 dark:border-indigo-500/80 bg-gradient-to-br from-indigo-50/90 via-indigo-50/40 to-white dark:from-indigo-950/70 dark:via-indigo-950/30 dark:to-slate-900 ring-2 ring-indigo-500/15 dark:ring-indigo-400/20 shadow-sm'
                        : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800/60 hover:border-indigo-200 dark:hover:border-indigo-800/80 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-mono text-xs font-bold tracking-wider transition-colors duration-200 ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 dark:bg-indigo-500 dark:text-white'
                            : 'bg-slate-100 text-slate-600 border border-slate-200/80 group-hover:bg-indigo-50 group-hover:text-indigo-600 group-hover:border-indigo-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700/80 dark:group-hover:bg-indigo-950/70 dark:group-hover:text-indigo-300 dark:group-hover:border-indigo-800/70'
                        }`}
                      >
                        {langOpt.shortCode}
                      </span>

                      <span
                        className={`block font-semibold text-sm leading-tight whitespace-nowrap ${
                          isActive
                            ? 'text-indigo-950 dark:text-indigo-100'
                            : 'text-slate-700 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-slate-100'
                        }`}
                      >
                        {langOpt.label}
                      </span>
                    </div>

                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${
                        isActive
                          ? 'bg-indigo-600 dark:bg-indigo-500 text-white shadow-sm'
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
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <Bell className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.notifications')}
            </h2>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <ToggleSetting
            id="settings-notifications-switch"
            label={t('settings.enableNotifications')}
            description={t('settings.enableNotificationsDesc')}
            checked={settings.notifications}
            onChange={() => toggleSetting('notifications')}
          />
        </div>
      </div>

      {/* Plan & Billing Section */}
      <div
        className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
        data-testid="settings-billing-section"
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <CreditCard className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              {lang === 'vi' ? 'Gói dịch vụ & Thanh toán' : 'Plan & Billing'}
            </h2>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium uppercase text-slate-500 whitespace-nowrap">
                  {lang === 'vi' ? 'Gói hiện tại:' : 'Active Plan:'}
                </span>
                <Badge
                  data-testid="settings-active-tier-badge"
                  className={`whitespace-nowrap shrink-0 font-mono uppercase ${
                    planTier === 'ultra'
                      ? 'bg-violet-600 text-white'
                      : planTier === 'pro'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  CITRA {planTier.toUpperCase()}
                </Badge>
                {subscription?.billing_cycle && (
                  <Badge
                    variant="outline"
                    className="text-[11px] font-medium whitespace-nowrap shrink-0"
                  >
                    {formatBillingCycleLabel(subscription.billing_cycle, lang)}
                  </Badge>
                )}
              </div>
              <p
                data-testid="settings-quota-line"
                className="text-xs text-slate-600 dark:text-slate-300 font-mono leading-relaxed"
              >
                {(() => {
                  const qv = getQuotaView(quota, lang, { isAdmin });
                  const sizeUnlimited = isUnlimitedValue(quota.max_file_size_mb);
                  const pagesUnlimited =
                    isAdmin || isUnlimitedValue(quota.max_pages_per_pdf);
                  const limitsSummary =
                    sizeUnlimited && pagesUnlimited
                      ? lang === 'vi'
                        ? 'Không giới hạn dung lượng & số trang'
                        : 'Unlimited file size & pages'
                      : sizeUnlimited
                        ? lang === 'vi'
                          ? `Không giới hạn dung lượng · Tối đa ${qv.pages} trang`
                          : `Unlimited file size · Up to ${qv.pages} pages`
                        : pagesUnlimited
                          ? lang === 'vi'
                            ? `Tối đa ${qv.fileSize} · Không giới hạn số trang`
                            : `Up to ${qv.fileSize} · Unlimited pages`
                          : lang === 'vi'
                            ? `Tối đa ${qv.fileSize} & ${qv.pages} trang`
                            : `Up to ${qv.fileSize} & ${qv.pages} pages`;
                  if (qv.uploadsUnlimited) {
                    return lang === 'vi'
                      ? `Lượt tháng: ${qv.usage} · ${limitsSummary}`
                      : `Monthly checks: ${qv.usage} · ${limitsSummary}`;
                  }
                  return lang === 'vi'
                    ? `Lượt tháng: Đã dùng ${qv.usage} tài liệu · ${limitsSummary}`
                    : `Monthly checks: ${qv.usage} used · ${limitsSummary}`;
                })()}
              </p>
              {subscription?.cancel_at_period_end && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  {lang === 'vi'
                    ? 'Đã tắt tự động gia hạn. Bạn vẫn giữ quyền lợi gói đến hết chu kỳ hiện tại.'
                    : 'Auto-renewal is turned off. Paid benefits remain active until the end of the billing cycle.'}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {isAdmin ? (
                <span
                  data-testid="settings-admin-plan-note"
                  className="text-xs text-slate-500 dark:text-slate-400 max-w-xs"
                >
                  {lang === 'vi'
                    ? 'Quản trị viên luôn có toàn quyền Ultra, không giới hạn — không cần nâng cấp.'
                    : 'Administrators always have unlimited Ultra access — no upgrade needed.'}
                </span>
              ) : (
                <Button
                  asChild
                  size="sm"
                  data-testid="settings-upgrade-plan-btn"
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold whitespace-nowrap"
                >
                  <Link to="/pricing">
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    {isBasic
                      ? lang === 'vi'
                        ? 'Nâng cấp Pro / Ultra'
                        : 'Upgrade to Pro / Ultra'
                      : lang === 'vi'
                        ? 'Đổi gói / Chu kỳ'
                        : 'Change Plan / Cycle'}
                  </Link>
                </Button>
              )}

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
                      className="rounded-xl text-xs whitespace-nowrap"
                    >
                      {billingLoading && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      )}
                      {lang === 'vi'
                        ? 'Bật lại gia hạn'
                        : 'Reactivate Auto-Renew'}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={billingLoading}
                      data-testid="settings-cancel-sub-btn"
                      onClick={() => setConfirmCancelOpen(true)}
                      className="rounded-xl text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30 whitespace-nowrap"
                    >
                      {billingLoading && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      )}
                      {lang === 'vi' ? 'Hủy gia hạn' : 'Cancel Auto-Renew'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Transaction History */}
          {transactions.length > 0 && (
            <div className="space-y-2" data-testid="settings-transactions-list">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {lang === 'vi'
                  ? 'Lịch sử giao dịch gần đây'
                  : 'Recent Billing History'}
              </p>
              <div className="divide-y divide-slate-200/70 dark:divide-slate-800 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden text-xs">
                {transactions.slice(0, 5).map((tx) => (
                  <div
                    key={tx.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-2 bg-white dark:bg-slate-900 flex-wrap"
                  >
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <Badge
                        variant={
                          tx.status === 'succeeded' ? 'default' : 'secondary'
                        }
                        className="text-[10px] font-medium whitespace-nowrap"
                      >
                        {formatTransactionStatusLabel(tx.status, lang)}
                      </Badge>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        CITRA {tx.plan_name} (
                        {formatBillingCycleLabel(tx.billing_cycle, lang)})
                      </span>
                      {tx.promo_code && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[10px] font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                          {tx.promo_code}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-slate-600 dark:text-slate-400 flex-wrap">
                      <span className="whitespace-nowrap">
                        {formatPaymentMethodSummary(tx, lang)}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatTransactionAmount(tx, lang)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Developer Access (API) — closed by default for all non-admin users without existing keys */}
      <details
        open={apiSectionOpen}
        onToggle={(e) => {
          setApiSectionTouched(true);
          setApiSectionOpen(e.currentTarget.open);
        }}
        className="group rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
        data-testid="settings-api-keys-section"
      >
        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center justify-between gap-2.5 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <KeyRound className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
            <span className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              {lang === 'vi'
                ? 'Dành cho lập trình viên (API)'
                : 'Developer Access (API)'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">
              {lang === 'vi' ? 'Tùy chọn nâng cao' : 'Optional'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400 transition-transform duration-200 group-open:rotate-180" />
          </div>
        </summary>

        <div className="p-4 sm:p-6 space-y-4 border-t border-slate-200/80 dark:border-slate-800">
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {t('settings.apiKeysSubtitle')}
          </p>

          {!canManageApiKeys ? (
            <div
              data-testid="api-key-upgrade-prompt"
              className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {lang === 'vi'
                    ? 'Kết nối API cá nhân dành cho gói CITRA Pro hoặc Ultra'
                    : 'Personal API access requires CITRA Pro or Ultra'}
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  {lang === 'vi'
                    ? 'Nâng cấp gói để kết nối CITRA với Zotero, Overleaf hoặc công cụ nghiên cứu tự động.'
                    : 'Upgrade your plan to connect CITRA with Zotero, Overleaf, or automated research tools.'}
                </p>
              </div>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="rounded-xl font-semibold shrink-0 whitespace-nowrap"
              >
                <Link to="/pricing">
                  <Sparkles className="h-3.5 w-3.5 mr-1.5 text-indigo-600 dark:text-indigo-400" />
                  {lang === 'vi' ? 'Xem gói Pro' : 'View Pro Plans'}
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <Label htmlFor="settings-api-key-name" className="sr-only">
                  {lang === 'vi' ? 'Tên khóa API mới' : 'New API key name'}
                </Label>
                <input
                  id="settings-api-key-name"
                  type="text"
                  data-testid="api-key-name-input"
                  aria-label={
                    lang === 'vi' ? 'Tên khóa API mới' : 'New API key name'
                  }
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder={
                    lang === 'vi'
                      ? 'Tên khóa kết nối (VD: Zotero, Overleaf…)'
                      : 'Key name (e.g. Zotero, Overleaf…)'
                  }
                  maxLength={120}
                  className="flex-none sm:flex-1 w-full h-11 min-h-[44px] shrink-0 px-3.5 rounded-xl text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <Button
                  type="button"
                  size="sm"
                  data-testid="create-api-key-btn"
                  disabled={!newKeyName.trim() || creatingKey}
                  onClick={handleCreateApiKey}
                  className="h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shrink-0 whitespace-nowrap"
                >
                  {creatingKey ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {t('settings.apiKeyCreateBtn')}
                </Button>
              </div>

              {newlyCreatedKey && (
                <div
                  data-testid="created-api-key-banner"
                  className="p-3.5 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                      {t('settings.apiKeyCopyWarning')}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid="copy-raw-api-key-btn"
                      onClick={handleCopyRawKey}
                      className="h-7 px-2.5 text-xs font-mono border-emerald-300 dark:border-emerald-700 inline-flex items-center gap-1"
                    >
                      <IconSwap
                        active={copiedRawKey}
                        iconA={<Copy className="h-3.5 w-3.5" />}
                        iconB={
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        }
                      />
                      <TextMorph
                        text={
                          copiedRawKey
                            ? lang === 'vi'
                              ? 'Đã chép!'
                              : 'Copied!'
                            : lang === 'vi'
                              ? 'Sao chép'
                              : 'Copy'
                        }
                      />
                    </Button>
                  </div>
                  <code
                    data-testid="created-api-key-secret"
                    className="block w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-950 border border-emerald-200 dark:border-emerald-900 font-mono text-xs text-emerald-800 dark:text-emerald-300 select-all break-all"
                  >
                    {newlyCreatedKey.raw_key}
                  </code>
                </div>
              )}

              {apiKeys.length > 0 && (
                <div
                  data-testid="api-keys-list"
                  className="divide-y divide-slate-200/70 dark:divide-slate-800 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden text-xs"
                >
                  {apiKeys.map((k) => (
                    <div
                      key={k.id}
                      data-testid={`api-key-row-${k.id}`}
                      className="px-4 py-3 flex items-center justify-between gap-3 bg-white dark:bg-slate-900 flex-wrap"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {k.name}
                          </span>
                          <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                            {k.key_prefix}••••
                          </code>
                        </div>
                        <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {k.last_used_at
                            ? lang === 'vi'
                              ? `Dùng lần cuối: ${formatLocalizedDate(k.last_used_at, lang)}`
                              : `Last used: ${formatLocalizedDate(k.last_used_at, lang)}`
                            : lang === 'vi'
                              ? 'Chưa từng dùng'
                              : 'Never used'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-testid={`revoke-api-key-btn-${k.id}`}
                        onClick={() => handleRevokeApiKey(k.id)}
                        className="h-8 px-2.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        {t('settings.apiKeyRevokeBtn')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </details>

      {/* Privacy & Account Deletion Section (DLCN-03) */}
      <div
        id="delete-account-section"
        data-testid="settings-privacy-section"
        className="scroll-mt-20 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              {lang === 'vi'
                ? 'Quyền riêng tư & Xóa tài khoản'
                : 'Privacy & Account Deletion'}
            </h2>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {lang === 'vi'
              ? 'Xem lại chính sách bảo vệ dữ liệu cá nhân hoặc xóa vĩnh viễn tài khoản và toàn bộ bài viết đã tải lên.'
              : 'Review our privacy policy or permanently delete your account and all uploaded documents.'}
          </p>

          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {t('privacyCompliance.consentStatusLabel')}
                </span>
                {user?.privacy_consented_at ? (
                  <Badge
                    variant="outline"
                    className="text-[11px] font-medium border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/50 whitespace-nowrap"
                  >
                    {lang === 'vi' ? 'Đã đồng ý chính sách' : 'Policy accepted'}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-[11px] font-medium whitespace-nowrap"
                  >
                    {lang === 'vi'
                      ? 'Tài khoản tạo trước khi cập nhật chính sách'
                      : 'Created before current Privacy Policy'}
                  </Badge>
                )}
              </div>
              {user?.privacy_consented_at && (
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {formatLocalizedDateTime(user.privacy_consented_at, lang)}
                </p>
              )}
            </div>

            <Link
              to="/privacy"
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors shrink-0 whitespace-nowrap"
            >
              <span>
                {lang === 'vi'
                  ? 'Xem Chính sách bảo mật'
                  : 'Read Privacy Policy'}
              </span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="rounded-xl border border-red-200/80 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-red-900 dark:text-red-200 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                {t('privacyCompliance.deleteAccountZoneTitle')}
              </h3>
              <p className="text-xs text-red-800/90 dark:text-red-300/80 leading-relaxed">
                {t('privacyCompliance.deleteAccountZoneDesc')}
              </p>
            </div>

            <Button
              type="button"
              variant="destructive"
              data-testid="settings-delete-account-btn"
              onClick={() => {
                setDeletePassword('');
                setDeleteConfirmUsername('');
                setDeleteError('');
                setDeleteModalOpen(true);
              }}
              className="shrink-0 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {t('privacyCompliance.deleteAccountBtn')}
            </Button>
          </div>
        </div>
      </div>

      {/* About Section */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <Info className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.about')}
            </h2>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-3">
          <InfoRow label={t('settings.version')} value={APP_VERSION} />
          <InfoRow
            label={t('settings.buildDate')}
            value={formatLocalizedDate(APP_BUILD_DATE, lang)}
          />
          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center gap-4 text-xs">
            <Link
              to="/privacy"
              className="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 underline underline-offset-4 transition-colors"
            >
              {lang === 'vi' ? 'Chính sách bảo mật' : 'Privacy Policy'}
            </Link>
            <Link
              to="/terms"
              className="text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 underline underline-offset-4 transition-colors"
            >
              {lang === 'vi' ? 'Điều khoản sử dụng' : 'Terms of Service'}
            </Link>
          </div>
        </div>
      </div>

      {/* Self-service Account Deletion Confirmation Modal — portaled to body to prevent space-y-6 strip */}
      {deleteModalMarkup &&
        (typeof document !== 'undefined'
          ? createPortal(deleteModalMarkup, document.body)
          : deleteModalMarkup)}

      <ConfirmationModal
        isOpen={confirmCancelOpen}
        variant="danger"
        title={
          lang === 'vi' ? 'Tắt tự động gia hạn?' : 'Turn off auto-renewal?'
        }
        message={
          lang === 'vi'
            ? `Gói ${planTier.toUpperCase()} sẽ không được gia hạn. Bạn vẫn giữ toàn bộ quyền lợi đến ${
                subscription?.current_period_end
                  ? formatLocalizedDate(subscription.current_period_end, lang)
                  : 'hết chu kỳ hiện tại'
              }, sau đó tài khoản chuyển về gói Basic.`
            : `Your ${planTier.toUpperCase()} plan will not renew. You keep all paid benefits until ${
                subscription?.current_period_end
                  ? formatLocalizedDate(subscription.current_period_end, lang)
                  : 'the end of the current billing cycle'
              }, then the account moves to Basic.`
        }
        confirmLabel={lang === 'vi' ? 'Tắt gia hạn' : 'Turn off auto-renew'}
        cancelLabel={lang === 'vi' ? 'Giữ gói' : 'Keep my plan'}
        onConfirm={async () => {
          setConfirmCancelOpen(false);
          await handleCancelSubscription(false);
        }}
        onCancel={() => setConfirmCancelOpen(false)}
      />
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

interface ToggleSettingProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}

function ToggleSetting({
  id,
  label,
  description,
  checked,
  onChange,
}: ToggleSettingProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label
          htmlFor={id}
          className="font-medium text-sm text-slate-900 dark:text-slate-100 cursor-pointer"
        >
          {label}
        </Label>
        {description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {description}
          </p>
        )}
      </div>
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
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
