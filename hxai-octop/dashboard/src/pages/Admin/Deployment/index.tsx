import { useEffect, useState } from "react";
import { Button, Input, Radio, Typography } from "antd";
import { message } from "@/utils/antdMessage";
import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageShell from "../../../layouts/PageShell";
import { request } from "../../../api/request";
import { apiErrorMessage } from "../../../utils/apiError";

interface DeploymentState {
  mode: "standalone" | "server";
  server_url: string;
  env_server_url: string;
  mode_source: "setting" | "env" | "default";
  client_config?: { version?: string } | null;
  client_token_set?: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  setting: "settings.deployment.sourceSetting",
  env: "settings.deployment.sourceEnv",
  default: "settings.deployment.sourceDefault",
};

export default function AdminDeploymentPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<DeploymentState | null>(null);
  const [mode, setMode] = useState<"standalone" | "server">("standalone");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    request<DeploymentState>("/api/deployment")
      .then((d) => {
        setState(d);
        setMode(d.mode);
        setUrl(d.server_url);
      })
      .catch((err) => message.error(apiErrorMessage(err, "加载失败", t)));
  }, [t]);

  const save = async () => {
    setSaving(true);
    try {
      const d = await request<DeploymentState>("/api/deployment", {
        method: "PUT",
        body: JSON.stringify({
          mode,
          server_url: url,
          ...(token ? { client_token: token } : {}),
        }),
      });
      setState(d);
      setToken("");
      message.success(t("settings.deployment.saved", "已保存"));
    } catch (err) {
      message.error(apiErrorMessage(err, "保存失败", t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title={t("settings.deployment.title", "服务端连接")}
      subtitle={t(
        "settings.deployment.subtitle",
        "实例与服务端的连接模式与地址",
      )}
      actions={
        <Button
          type="primary"
          icon={<Server size={16} />}
          loading={saving}
          onClick={() => void save()}
          disabled={mode === "server" && !url.trim()}
        >
          {t("settings.deployment.save", "保存")}
        </Button>
      }
    >
      <div style={{ maxWidth: 640, padding: "8px 4px" }}>
        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <Radio value="standalone">
            {t("settings.deployment.standalone", "单体模式")}
            <Typography.Text
              type="secondary"
              style={{ display: "block", fontSize: 12 }}
            >
              {t(
                "settings.deployment.standaloneHint",
                "独立运行：本地账号体系，可自行注册与管理用户",
              )}
            </Typography.Text>
          </Radio>
          <Radio value="server">
            {t("settings.deployment.server", "服务模式")}
            <Typography.Text
              type="secondary"
              style={{ display: "block", fontSize: 12 }}
            >
              {t(
                "settings.deployment.serverHint",
                "连接服务端：身份由中心端统一管理，本地不注册新用户",
              )}
            </Typography.Text>
          </Radio>
        </Radio.Group>

        <div style={{ marginTop: 20 }}>
          <Typography.Text strong>
            {t("settings.deployment.serverUrl", "服务端地址")}
          </Typography.Text>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={state?.env_server_url || "https://admin.example.com"}
            style={{ marginTop: 8, maxWidth: 420 }}
            disabled={mode !== "server"}
          />
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginTop: 8 }}
          >
            {state && (
              <>
                {t(SOURCE_LABEL[state.mode_source] || "", state.mode_source)}
                {state.client_config?.version
                  ? ` · client-config v${state.client_config.version}`
                  : ""}
              </>
            )}
          </Typography.Paragraph>
          {mode === "server" && (
            <div style={{ marginTop: 16, maxWidth: 420 }}>
              <Typography.Text strong>
                {t("settings.deployment.clientToken", "实例令牌")}
              </Typography.Text>
              <Input.Password
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={
                  state?.client_token_set
                    ? t(
                        "settings.deployment.tokenSet",
                        "已配置，输入新值可更换",
                      )
                    : t(
                        "settings.deployment.tokenHint",
                        "服务端签发的客户端令牌（可选）",
                      )
                }
                style={{ marginTop: 8 }}
                autoComplete="off"
              />
            </div>
          )}
          {mode === "server" && (
            <Typography.Paragraph type="warning" style={{ fontSize: 12 }}>
              {t(
                "settings.deployment.serverWarn",
                "服务模式开启后：本地建号与邀请兑换将被禁用，登录走服务端 SSO；已存在的本地账号数据保留。",
              )}
            </Typography.Paragraph>
          )}
        </div>
      </div>
    </PageShell>
  );
}
