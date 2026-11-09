package service

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/url"
	"strings"
	"sync"
	"time"

	jwtlib "github.com/golang-jwt/jwt/v5"
	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/ids"
)

/* ------------------------- OIDC Provider（IdP） ------------------------- */

const oidcKeySetting = "oidc.rsa_private_pem"
const oidcKeyID = "hx-oidc-1"
const authCodeTTL = 5 * time.Minute
const idTokenTTL = time.Hour

// OIDCIssuer 返回本 IdP 的 issuer（= PublicBaseURL，必须与 discovery 里的 issuer 严格一致）。
func OIDCIssuer(d Deps) string {
	return strings.TrimRight(d.Cfg.PublicBaseURL, "/")
}

// rsaKey 惰性生成并持久化一把 RSA-2048 签名私钥（settings 表）。
var (
	oidcKeyMu  sync.Mutex
	oidcKey    *rsa.PrivateKey
	oidcKeyErr error
)

func rsaKey(d Deps) (*rsa.PrivateKey, error) {
	oidcKeyMu.Lock()
	defer oidcKeyMu.Unlock()
	if oidcKey != nil || oidcKeyErr != nil {
		return oidcKey, oidcKeyErr
	}
	pemText, err := d.Settings.GetOrCreate(oidcKeySetting, "", func() string {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return ""
		}
		der := x509.MarshalPKCS1PrivateKey(key)
		return string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: der}))
	})
	if err != nil {
		oidcKeyErr = err
		return nil, err
	}
	block, _ := pem.Decode([]byte(pemText))
	if block == nil {
		oidcKeyErr = fmt.Errorf("oidc rsa key corrupted in settings")
		return nil, oidcKeyErr
	}
	oidcKey, oidcKeyErr = x509.ParsePKCS1PrivateKey(block.Bytes)
	return oidcKey, oidcKeyErr
}

func b64urlInt(v *big.Int) string {
	return base64.RawURLEncoding.EncodeToString(v.Bytes())
}

// Discovery 返回 /.well-known/openid-configuration 文档。
func Discovery(d Deps) map[string]any {
	iss := OIDCIssuer(d)
	return map[string]any{
		"issuer":                                iss,
		"authorization_endpoint":                iss + "/oauth/authorize",
		"token_endpoint":                        iss + "/oauth/token",
		"jwks_uri":                              iss + "/oauth/jwks",
		"userinfo_endpoint":                     iss + "/oauth/userinfo",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"scopes_supported":                      []string{"openid", "profile", "email"},
		"token_endpoint_auth_methods_supported": []string{"client_secret_post", "client_secret_basic", "none"},
		"code_challenge_methods_supported":      []string{"S256"},
		"claims_supported": []string{
			"sub", "iss", "aud", "exp", "iat", "nonce",
			"name", "preferred_username", "email",
		},
	}
}

// JWKS 返回公钥集。
func JWKS(d Deps) (map[string]any, error) {
	key, err := rsaKey(d)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"keys": []map[string]any{
			{
				"kty": "RSA",
				"use": "sig",
				"kid": oidcKeyID,
				"alg": "RS256",
				"n":   b64urlInt(key.PublicKey.N),
				"e":   b64urlInt(big.NewInt(int64(key.PublicKey.E))),
			},
		},
	}, nil
}

/* ------------------------- 客户端登记 ------------------------- */

type OAuthClientView struct {
	ID           string   `json:"id"`
	ClientID     string   `json:"clientId"`
	Name         string   `json:"name"`
	RedirectURIs []string `json:"redirectUris"`
	HasSecret    bool     `json:"hasSecret"`
	Status       string   `json:"status"`
	CreatedAt    string   `json:"createdAt"`
}

func toOAuthClientView(c *model.OAuthClient) OAuthClientView {
	return OAuthClientView{
		ID:           c.ID,
		ClientID:     c.ClientID,
		Name:         c.Name,
		RedirectURIs: parseStringArray(c.RedirectURIs),
		HasSecret:    c.SecretHash != nil && *c.SecretHash != "",
		Status:       c.Status,
		CreatedAt:    isoFormat(c.CreatedAt),
	}
}

func ListOAuthClients(d Deps) []OAuthClientView {
	var rows []model.OAuthClient
	d.DB.Order("created_at ASC").Find(&rows)
	out := make([]OAuthClientView, 0, len(rows))
	for i := range rows {
		out = append(out, toOAuthClientView(&rows[i]))
	}
	return out
}

// CreateOAuthClient 登记客户端；secret 为空则为公共客户端（仅 PKCE）。
// 返回视图与一次性明文 secret（若生成）。
func CreateOAuthClient(d Deps, actor *Actor, in struct {
	ClientID     string   `json:"clientId"`
	Name         string   `json:"name"`
	RedirectURIs []string `json:"redirectUris"`
	Secret       string   `json:"secret"`
}) (OAuthClientView, string, error) {
	clientID := strings.TrimSpace(in.ClientID)
	name := strings.TrimSpace(in.Name)
	if clientID == "" || name == "" {
		return OAuthClientView{}, "", apperr.Bad("clientId 与 name 必填")
	}
	uris := make([]string, 0, len(in.RedirectURIs))
	for _, raw := range in.RedirectURIs {
		u := strings.TrimSpace(raw)
		if u == "" {
			continue
		}
		parsed, err := url.Parse(u)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return OAuthClientView{}, "", apperr.Bad("redirect_uri 非法：" + u)
		}
		uris = append(uris, u)
	}
	if len(uris) == 0 {
		return OAuthClientView{}, "", apperr.Bad("至少登记一个 redirect_uri")
	}
	var count int64
	d.DB.Model(&model.OAuthClient{}).Where("client_id = ?", clientID).Count(&count)
	if count > 0 {
		return OAuthClientView{}, "", apperr.Conflict("clientId 已存在：" + clientID)
	}
	secret := strings.TrimSpace(in.Secret)
	var secretHash *string
	if secret != "" {
		sum := sha256.Sum256([]byte(secret))
		h := hex.EncodeToString(sum[:])
		secretHash = &h
	}
	row := model.OAuthClient{
		ID:           ids.New("oc"),
		ClientID:     clientID,
		Name:         name,
		SecretHash:   secretHash,
		RedirectURIs: mustJSON(uris),
		Status:       "enabled",
		CreatedAt:    time.Now().UTC(),
	}
	if err := d.DB.Create(&row).Error; err != nil {
		return OAuthClientView{}, "", err
	}
	_ = Audit(d, actor, "oauth_client.create",
		map[string]string{"type": "oauth_client", "id": row.ID, "name": name}, nil)
	return toOAuthClientView(&row), secret, nil
}

func findOAuthClient(d Deps, clientID string) (*model.OAuthClient, error) {
	var row model.OAuthClient
	if err := d.DB.Where("client_id = ? AND status = ?", clientID, "enabled").Take(&row).Error; err != nil {
		return nil, apperr.Bad("未知或已禁用的 client_id")
	}
	return &row, nil
}

func oauthClientAllowsRedirect(c *model.OAuthClient, uri string) bool {
	for _, allowed := range parseStringArray(c.RedirectURIs) {
		if allowed == uri {
			return true
		}
	}
	return false
}

func oauthClientCheckSecret(c *model.OAuthClient, provided string) bool {
	if c.SecretHash == nil || *c.SecretHash == "" {
		return true // 公共客户端，仅需 PKCE
	}
	sum := sha256.Sum256([]byte(provided))
	return subtle.ConstantTimeCompare([]byte(hex.EncodeToString(sum[:])), []byte(*c.SecretHash)) == 1
}

/* ------------------------- 授权码流程 ------------------------- */

type authCode struct {
	userID        string
	clientID      string
	redirectURI   string
	codeChallenge string
	nonce         string
	expiresAt     time.Time
}

var (
	authCodesMu sync.Mutex
	authCodes   = map[string]authCode{}
)

// AuthorizeIssue 校验授权请求并为已登录用户签发授权码，返回重定向 URL。
func AuthorizeIssue(d Deps, user *model.User, q url.Values) (string, error) {
	if q.Get("response_type") != "code" {
		return "", apperr.Bad("仅支持 response_type=code")
	}
	client, err := findOAuthClient(d, q.Get("client_id"))
	if err != nil {
		return "", err
	}
	redirectURI := q.Get("redirect_uri")
	if !oauthClientAllowsRedirect(client, redirectURI) {
		return "", apperr.Bad("redirect_uri 未登记")
	}
	if q.Get("code_challenge_method") != "S256" || strings.TrimSpace(q.Get("code_challenge")) == "" {
		return "", apperr.Bad("必须使用 PKCE S256")
	}
	scope := q.Get("scope")
	if !strings.Contains(scope, "openid") {
		return "", apperr.Bad("scope 必须包含 openid")
	}
	code := "ac_" + ids.Token(24)
	authCodesMu.Lock()
	for k, v := range authCodes { // 顺手清理过期码
		if time.Now().After(v.expiresAt) {
			delete(authCodes, k)
		}
	}
	authCodes[code] = authCode{
		userID:        user.ID,
		clientID:      client.ClientID,
		redirectURI:   redirectURI,
		codeChallenge: q.Get("code_challenge"),
		nonce:         q.Get("nonce"),
		expiresAt:     time.Now().Add(authCodeTTL),
	}
	authCodesMu.Unlock()

	sep := "?"
	if strings.Contains(redirectURI, "?") {
		sep = "&"
	}
	return redirectURI + sep + "code=" + url.QueryEscape(code) + "&state=" + url.QueryEscape(q.Get("state")), nil
}

// TokenExchange 校验 code + PKCE + 客户端密钥，签发 id_token（RS256）。
func TokenExchange(d Deps, form url.Values) (map[string]any, error) {
	if form.Get("grant_type") != "authorization_code" {
		return nil, apperr.Bad("仅支持 grant_type=authorization_code")
	}
	clientID := form.Get("client_id")
	// HTTP Basic 认证兜底
	if clientID == "" {
		if auth := form.Get("__basic_auth"); auth != "" {
			if decoded, err := base64.StdEncoding.DecodeString(auth); err == nil {
				parts := strings.SplitN(string(decoded), ":", 2)
				clientID = parts[0]
				if len(parts) == 2 {
					form.Set("client_secret", parts[1])
				}
			}
		}
	}
	client, err := findOAuthClient(d, clientID)
	if err != nil {
		return nil, err
	}
	if !oauthClientCheckSecret(client, form.Get("client_secret")) {
		return nil, apperr.Unauthorized("client_secret 校验失败")
	}
	code := form.Get("code")
	authCodesMu.Lock()
	ac, ok := authCodes[code]
	if ok {
		delete(authCodes, code) // 一次性
	}
	authCodesMu.Unlock()
	if !ok || time.Now().After(ac.expiresAt) {
		return nil, apperr.Bad("code 无效或已过期")
	}
	if ac.clientID != client.ClientID || ac.redirectURI != form.Get("redirect_uri") {
		return nil, apperr.Bad("code 与客户端/redirect_uri 不匹配")
	}
	verifier := form.Get("code_verifier")
	sum := sha256.Sum256([]byte(verifier))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != ac.codeChallenge {
		return nil, apperr.Bad("PKCE 校验失败")
	}

	var user model.User
	if err := d.DB.Where("id = ? AND status = ?", ac.userID, "active").Take(&user).Error; err != nil {
		return nil, apperr.Bad("用户不存在或已禁用")
	}
	key, err := rsaKey(d)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	claims := jwtlib.MapClaims{
		"iss":                OIDCIssuer(d),
		"sub":                user.ID,
		"aud":                client.ClientID,
		"iat":                now.Unix(),
		"exp":                now.Add(idTokenTTL).Unix(),
		"name":               user.DisplayName,
		"preferred_username": user.Username,
	}
	if ac.nonce != "" {
		claims["nonce"] = ac.nonce
	}
	if user.Email != nil && *user.Email != "" {
		claims["email"] = *user.Email
	}
	token := jwtlib.NewWithClaims(jwtlib.SigningMethodRS256, claims)
	token.Header["kid"] = oidcKeyID
	idToken, err := token.SignedString(key)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"access_token": "atk_" + ids.Token(24),
		"token_type":   "Bearer",
		"expires_in":   int(idTokenTTL.Seconds()),
		"id_token":     idToken,
	}, nil
}
