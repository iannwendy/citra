import { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/contexts/AuthContext';
import { api, type GoogleLoginPayload } from '@/api/client';

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

const GSI_SCRIPT_ID = 'google-identity-services-sdk';
const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google Identity Services SDK')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.id = GSI_SCRIPT_ID;
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Failed to load Google Identity Services SDK'));
    document.head.appendChild(script);
  });
}

function GoogleLogoIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

interface GoogleAuthButtonProps {
  onError: (msg: string) => void;
  disabled?: boolean;
  beforeAuth?: () => boolean;
  googlePayloadExtras?: Partial<GoogleLoginPayload>;
}

export function GoogleAuthButton({
  onError,
  disabled = false,
  beforeAuth,
  googlePayloadExtras,
}: GoogleAuthButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authContext = useContext(AuthContext);
  const loginWithGoogle = authContext?.loginWithGoogle;
  const envClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const [clientId, setClientId] = useState<string>(envClientId);
  const [googleLoading, setGoogleLoading] = useState(false);
  const verifyingBackendRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    if (envClientId) {
      void loadGoogleIdentityScript().catch(() => {});
      return;
    }

    api
      .getGoogleConfig()
      .then((cfg) => {
        if (!mounted) return;
        if (cfg?.enabled && cfg.client_id) {
          setClientId(cfg.client_id);
          void loadGoogleIdentityScript().catch(() => {});
        }
      })
      .catch(() => {
        // Silently ignore in offline or unit test environments
      });

    return () => {
      mounted = false;
    };
  }, [envClientId]);

  const openGooglePopup = (activeClientId: string) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      onError(t('auth.googleLoginError'));
      setGoogleLoading(false);
      return;
    }

    const tokenClient = oauth2.initTokenClient({
      client_id: activeClientId,
      scope: 'openid email profile',
      prompt: 'select_account',
      callback: async (response: GoogleTokenResponse) => {
        if (response.error || !response.access_token) {
          setGoogleLoading(false);
          if (response.error && response.error !== 'popup_closed_by_user') {
            onError(response.error_description || t('auth.googleLoginError'));
          }
          return;
        }

        verifyingBackendRef.current = true;
        try {
          const payload: GoogleLoginPayload = {
            access_token: response.access_token,
            ...googlePayloadExtras,
          };
          if (loginWithGoogle) {
            await loginWithGoogle(payload);
          } else {
            await api.googleLogin(payload);
          }
          navigate('/dashboard');
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : t('auth.googleLoginError');
          if (msg.includes('ACCOUNT_DEACTIVATED')) {
            onError(msg.replace('ACCOUNT_DEACTIVATED: ', ''));
          } else {
            onError(msg);
          }
        } finally {
          verifyingBackendRef.current = false;
          setGoogleLoading(false);
        }
      },
      error_callback: (err) => {
        setGoogleLoading(false);
        if (err?.type && err.type !== 'popup_closed') {
          onError(err.message || t('auth.googleLoginError'));
        }
      },
    });

    tokenClient.requestAccessToken({ prompt: 'select_account' });
  };

  const handleGoogleClick = async () => {
    if (beforeAuth && !beforeAuth()) {
      return;
    }
    onError('');
    setGoogleLoading(true);

    try {
      // Fast synchronous path if clientId and GIS SDK are already loaded (avoids popup blockers)
      if (clientId && window.google?.accounts?.oauth2) {
        openGooglePopup(clientId);
        return;
      }

      let activeClientId = clientId;
      if (!activeClientId) {
        try {
          const cfg = await api.getGoogleConfig();
          if (cfg?.enabled && cfg.client_id) {
            activeClientId = cfg.client_id;
            setClientId(cfg.client_id);
          }
        } catch {
          // Ignore config fetch error
        }
      }

      if (!activeClientId) {
        onError(t('auth.googleNotConfigured'));
        setGoogleLoading(false);
        return;
      }

      await loadGoogleIdentityScript();
      openGooglePopup(activeClientId);
    } catch (err) {
      setGoogleLoading(false);
      onError(err instanceof Error ? err.message : t('auth.googleLoginError'));
    }
  };

  return (
    <div className="mt-4 space-y-3.5">
      <div className="relative flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <div
            style={{ borderColor: 'var(--solva-border)' }}
            className="w-full border-t"
          />
        </div>
        <span
          style={{
            backgroundColor: 'var(--solva-card-elevated)',
            color: 'var(--solva-muted)',
          }}
          className="relative px-3 text-[11px] font-mono uppercase tracking-wider"
        >
          {t('auth.orContinueWith')}
        </span>
      </div>

      <button
        type="button"
        disabled={disabled || googleLoading}
        onClick={handleGoogleClick}
        data-testid="google-auth-button"
        style={{
          backgroundColor: 'var(--solva-surface)',
          borderColor: 'var(--solva-border)',
          color: 'var(--solva-ink)',
        }}
        className="group relative w-full h-[44px] px-4 rounded-[11px] border font-solva-sans text-[14px] font-medium flex items-center justify-center gap-2.5 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-sm active:scale-[0.985] disabled:opacity-50 disabled:pointer-events-none cursor-pointer select-none"
      >
        {googleLoading ? (
          <>
            <div className="h-4 w-4 border-2 border-[#D6D0C4] dark:border-[#332F26] border-t-[#1C1A15] dark:border-t-[#FBFAF6] rounded-full animate-spin" />
            <span>{t('auth.connectingGoogle')}</span>
          </>
        ) : (
          <>
            <GoogleLogoIcon />
            <span>{t('auth.continueWithGoogle')}</span>
          </>
        )}
      </button>
    </div>
  );
}
