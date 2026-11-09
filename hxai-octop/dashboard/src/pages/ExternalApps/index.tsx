import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, LayoutGrid } from "lucide-react";
import { request } from "../../api/request";

const iconIsUrl = (i?: string) => !!i && /^(https?:|\/|data:)/.test(i);

type ExternalApp = {
  id: string;
  name: string;
  url: string;
  desc: string;
  icon: string;
  color: string;
  openMode: "iframe" | "external";
};

export default function ExternalAppsPage() {
  const { t } = useTranslation();
  const { appId } = useParams<{ appId?: string }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<ExternalApp[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    request<{ items: ExternalApp[] }>("/deployment/external-apps")
      .then((d) => {
        if (!cancelled) setItems(d.items || []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const app = appId ? items.find((a) => a.id === appId) : undefined;

  // 内嵌视图：标题栏 + iframe（external 模式跳外部）
  if (appId) {
    if (!app) {
      if (!loaded) return null;
      return (
        <div style={{ padding: 40, color: "var(--fn-text-secondary)" }}>
          {t("apps.notFound", "应用不存在或已停用")}
        </div>
      );
    }
    if (app.openMode === "external") {
      window.open(app.url, "_blank", "noopener");
      navigate("/apps", { replace: true });
      return null;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px",
            borderBottom: "1px solid var(--fn-border, #e2e8f0)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => navigate("/apps")}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--fn-text-secondary)",
              padding: 0,
            }}
          >
            ‹ {t("apps.back", "返回")}
          </button>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{app.name}</span>
          <span style={{ flex: 1 }} />
          <a
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: "var(--fn-text-tertiary)",
              textDecoration: "none",
            }}
          >
            <ExternalLink size={13} />
            {t("apps.openExternal", "外部打开")}
          </a>
        </div>
        <iframe
          src={app.url}
          title={app.name}
          style={{ flex: 1, width: "100%", border: "none", background: "#fff" }}
        />
      </div>
    );
  }

  // 列表视图
  return (
    <div style={{ padding: "24px 28px", overflow: "auto", height: "100%" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 600 }}>
        {t("apps.title", "应用")}
      </h2>
      <p
        style={{
          margin: "0 0 20px",
          fontSize: 13,
          color: "var(--fn-text-secondary)",
        }}
      >
        {t("apps.desc", "工作台下发的外部应用入口。")}
      </p>
      {loaded && items.length === 0 ? (
        <p style={{ color: "var(--fn-text-tertiary)", fontSize: 13 }}>
          {t("apps.empty", "暂无可用应用，由管理端配置下发。")}
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          {items.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => navigate(`/apps/${encodeURIComponent(a.id)}`)}
              style={{
                textAlign: "left",
                padding: "16px",
                borderRadius: 14,
                border: "1px solid var(--fn-border, #e8eaf0)",
                background: "var(--fn-bg-elevated, #fff)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                minWidth: 0,
                transition: "box-shadow .15s ease, transform .15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,.08)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.transform = "none";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    flexShrink: 0,
                    background: a.icon && iconIsUrl(a.icon)
                      ? "transparent"
                      : `${a.color || "#c00000"}1f`,
                    color: a.color || "var(--fn-primary, #c00000)",
                    overflow: "hidden",
                  }}
                >
                  {a.icon && iconIsUrl(a.icon) ? (
                    <img src={a.icon} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : a.icon ? (
                    <span>{a.icon}</span>
                  ) : (
                    <LayoutGrid size={20} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.name}
                  </div>

                </div>
                <span
                  style={{
                    fontSize: 10.5,
                    padding: "2px 7px",
                    borderRadius: 5,
                    background: a.openMode === "external" ? "#eff6ff" : "#fdf0f0",
                    color: a.openMode === "external" ? "#1d5cff" : "#c00000",
                    flexShrink: 0,
                  }}
                >
                  {a.openMode === "external" ? t("apps.mode_external", "外部") : t("apps.mode_iframe", "内嵌")}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--fn-text-tertiary)",
                  lineHeight: 1.55,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  minHeight: 38,
                }}
              >
                {a.desc || t("apps.default_desc", "工作台下发的应用入口，点击即可在工作台内打开使用。")}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderTop: "1px solid var(--fn-border, #f0f1f5)",
                  paddingTop: 10,
                  marginTop: "auto",
                }}
              >
                <span style={{ fontSize: 11, color: "var(--fn-text-tertiary)" }}>
                  {t("apps.open_hint", "点击卡片打开")}
                </span>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--fn-primary, #c00000)" }}>
                  {t("apps.open", "打开")} →
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
