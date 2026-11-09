import { useEffect, useRef, useState } from "react";
import { Button, Result, Spin } from "antd";
import { message } from "@/utils/antdMessage";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getRememberLoginPreference,
  isSessionOnlyAuth,
  setAuthToken,
} from "../../api";
import { authApi } from "../../api/modules/auth";
import { refreshServerLabels } from "../../i18n";
import { apiErrorMessage } from "../../utils/apiError";
import { applyUserLocale } from "../../utils/locale";
import { notifySsoOpener } from "../../utils/ssoPopup";

const DEFAULT_REDIRECT = "/chat";

/** Return an internal destination, never an absolute or protocol-relative URL. */
export function safeRedirect(path: string | null): string {
  if (
    !path ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("://") ||
    path.startsWith("http:")
  ) {
    return DEFAULT_REDIRECT;
  }
  return path;
}

/** Prefer URL fragment (not sent to servers); fall back to query for old links. */
export function readOidcCompleteParams(
  hash: string,
  search: string,
): { code: string | null; redirect: string | null; bind: boolean } {
  const fromHash = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  const fromQuery = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const bind = (fromHash.get("bind") || fromQuery.get("bind") || "") === "1";
  return {
    code: fromHash.get("code") || fromQuery.get("code"),
    redirect: fromHash.get("redirect") || fromQuery.get("redirect"),
    bind,
  };
}

const DESKTOP_SSO_LOOPBACK = "http://127.0.0.1:18765/sso-code";

export default function OidcComplete() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const did = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [handedOff, setHandedOff] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // 跳回桌面客户端后倒计时自动关闭；浏览器可能拦截非脚本打开的窗口
  useEffect(() => {
    if (!handedOff) return;
    if (countdown <= 0) {
      window.close();
      // 浏览器拦截非脚本打开的窗口时仍停留在本页：跳回登录页
      if (!window.closed) {
        window.location.replace("/login");
      }
      return;
    }
    const timer = window.setTimeout(() => setCountdown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [handedOff, countdown]);

  useEffect(() => {
    if (did.current) return;
    did.current = true;

    const { code, redirect, bind } = readOidcCompleteParams(
      window.location.hash,
      window.location.search,
    );
    if (!code) {
      const text = t("login.oidcComplete.missingCode");
      if (notifySsoOpener({ ok: false, error: "generic", bind })) return;
      setError(text);
      message.error(text);
      return;
    }

    // Drop credentials from the address bar before the network exchange.
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    const runExchange = () => {
      void authApi
        .exchangeOidcCode(code)
      .then(async (res) => {
        const dest = safeRedirect(redirect);
        if (bind) {
          // Account-link popups: opener already holds the session — do not
          // overwrite its storage from the popup's empty sessionStorage.
          if (notifySsoOpener({ ok: true, redirect: dest, bind: true })) {
            return;
          }
          setAuthToken(res.access_token, !isSessionOnlyAuth());
          await applyUserLocale(res.user.locale);
          void refreshServerLabels(res.user.locale);
          navigate(dest, { replace: true });
          return;
        }

        const remember = getRememberLoginPreference();
        if (
          notifySsoOpener({
            ok: true,
            redirect: dest,
            access_token: res.access_token,
            remember,
          })
        ) {
          return;
        }
        setAuthToken(res.access_token, remember);
        await applyUserLocale(res.user.locale);
        void refreshServerLabels(res.user.locale);
        navigate(dest, { replace: true });
      })
      .catch((err) => {
        const text = apiErrorMessage(err, t("login.oidcComplete.failed"), t);
        if (notifySsoOpener({ ok: false, error: "exchange", bind })) return;
        setError(text);
        message.error(text);
        });
    };

    // External-browser login (desktop SSO): hand the code to the shell's
    // loopback listener so the embedded webview completes the exchange.
    const inDesktopShell =
      typeof (window as { _wails?: unknown })._wails !== "undefined";
    if (!inDesktopShell) {
      fetch(`${DESKTOP_SSO_LOOPBACK}?code=${encodeURIComponent(code)}`, {
        signal: AbortSignal.timeout(1200),
      })
        .then((res) => (res.ok ? setHandedOff(true) : runExchange()))
        .catch(() => runExchange());
    } else {
      runExchange();
    }
  }, [navigate, t]);

  if (handedOff) {
    return (
      <Result
        status="success"
        title={t("login.oidcComplete.backToClient", "已跳回客户端")}
        subTitle={
          countdown > 0
            ? t("login.oidcComplete.autoCloseIn", "{{seconds}} 秒后自动关闭此页面", {
                seconds: countdown,
              })
            : t(
                "login.oidcComplete.backToClientHint",
                "授权码已发送到桌面应用，本页面可以关闭。",
              )
        }
      />
    );
  }

  if (error) {
    return (
      <Result
        status="error"
        title={t("login.oidcComplete.title")}
        subTitle={error}
        extra={
          <Button
            type="primary"
            onClick={() => navigate("/login", { replace: true })}
          >
            {t("login.oidcComplete.backToLogin")}
          </Button>
        }
      />
    );
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)",
      }}
    >
      <Spin size="large" tip={t("login.oidcComplete.loading")} />
    </div>
  );
}
