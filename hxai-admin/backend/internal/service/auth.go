package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/hx/control-plane/internal/config"
	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/i18n"
	"github.com/hx/control-plane/internal/platform/ids"
	"github.com/hx/control-plane/internal/platform/iso"
	jwt "github.com/hx/control-plane/internal/platform/jwtx"
	"github.com/hx/control-plane/internal/platform/passwd"
	"github.com/hx/control-plane/internal/store"
	"gorm.io/gorm"
)

type Deps struct {
	Cfg        config.Config
	DB         *gorm.DB
	Settings   *store.Settings
	JWT        *jwt.Issuer
	I18N       *i18n.Translator
	LoginGuard *LoginGuard
	StartedAt  time.Time
}

type PublicUser struct {
	ID          string   `json:"id"`
	Username    string   `json:"username"`
	DisplayName string   `json:"displayName"`
	Email       *string  `json:"email"`
	Department  *string  `json:"department"`
	Role        string   `json:"role"`
	Kind        string   `json:"kind"`
	ExtraPerms  []string `json:"extraPerms"`
	Status      string   `json:"status"`
	LastLoginAt *string  `json:"lastLoginAt"`
	CreatedAt   string   `json:"createdAt"`
}

func ToPublicUser(u *model.User) PublicUser {
	return PublicUser{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		Email:       u.Email,
		Department:  u.Department,
		Role:        u.Role,
		Kind:        u.Kind,
		ExtraPerms:  parseStringArray(u.ExtraPermsJSON),
		Status:      u.Status,
		LastLoginAt: iso.Ptr(u.LastLoginAt),
		CreatedAt:   iso.Format(u.CreatedAt),
	}
}

type Actor struct {
	User *model.User
	IP   string
}

func (a *Actor) Name() string {
	if a == nil || a.User == nil {
		return "系统"
	}
	return a.User.DisplayName
}

func Audit(d Deps, actor *Actor, action string, target map[string]string, detail any) error {
	rec := store.AuditRecord{Action: action, Detail: detail}
	if actor != nil {
		rec.IP = actor.IP
		if actor.User != nil {
			rec.ActorID = actor.User.ID
			rec.ActorName = actor.User.DisplayName
		}
	}
	rec.TargetType = target["type"]
	rec.TargetID = target["id"]
	rec.TargetName = target["name"]
	return store.Append(d.DB, rec)
}

/* ------------------------------ 会话 ------------------------------ */

type SessionManager struct {
	d   Deps
	ttl time.Duration
}

func NewSessionManager(d Deps) *SessionManager {
	return &SessionManager{d: d, ttl: d.Cfg.TokenTTL}
}

func (s *SessionManager) Create(user *model.User, ip, ua string) (string, time.Time, error) {
	now := time.Now().UTC()
	jti := ids.Token(18)
	token, exp, err := s.d.JWT.Issue(user.ID, user.Role, jti, now)
	if err != nil {
		return "", time.Time{}, err
	}
	var ipPtr, uaPtr *string
	if ip != "" {
		ipPtr = &ip
	}
	if ua != "" {
		trimmed := ua
		if len(trimmed) > 200 {
			trimmed = trimmed[:200]
		}
		uaPtr = &trimmed
	}
	session := model.Session{
		JTI:       jti,
		UserID:    user.ID,
		CreatedAt: now,
		ExpiresAt: exp,
		IP:        ipPtr,
		UserAgent: uaPtr,
	}
	if err := s.d.DB.Create(&session).Error; err != nil {
		return "", time.Time{}, err
	}
	return token, exp, nil
}

func (s *SessionManager) Validate(token string) (*model.User, string, error) {
	claims, err := s.d.JWT.Parse(token)
	if err != nil {
		return nil, "", nil
	}
	if !s.sessionAlive(claims.JTI, claims.Subject, claims.ExpiresAt.Time) {
		return nil, "", nil
	}
	var user model.User
	if err := s.d.DB.Where("id = ?", claims.Subject).Take(&user).Error; err != nil {
		return nil, "", nil
	}
	if user.Status != "active" {
		return nil, "", nil
	}
	return &user, claims.JTI, nil
}

func (s *SessionManager) sessionAlive(jti, userID string, exp time.Time) bool {
	var session model.Session
	if err := s.d.DB.Where("jti = ?", jti).Take(&session).Error; err != nil {
		return false
	}
	if session.Revoked != 0 || session.ExpiresAt.Before(time.Now().UTC()) || session.UserID != userID {
		return false
	}
	return true
}

func (s *SessionManager) Revoke(jti string) {
	if jti == "" {
		return
	}
	s.d.DB.Model(&model.Session{}).Where("jti = ?", jti).Update("revoked", 1)
}

func (s *SessionManager) RevokeAllForUser(userID string) {
	s.d.DB.Model(&model.Session{}).Where("user_id = ?", userID).Update("revoked", 1)
}

func (s *SessionManager) ActiveCount(userID string) int64 {
	var count int64
	s.d.DB.Model(&model.Session{}).
		Where("user_id = ? AND revoked = 0 AND expires_at > ?", userID, time.Now().UTC()).
		Count(&count)
	return count
}

/* --------------------------- 登录失败锁定 --------------------------- */

type LockState struct {
	Locked     bool
	Failures   int
	RetryAfter int
}

type loginAttempt struct {
	Failures      int
	FirstFailedAt time.Time
	LockedUntil   time.Time
}

// LoginGuard 是单进程内的登录失败计数。当前控制面按单实例部署，
// 不引入 Redis；将来多实例再换成共享存储即可，接口语义保持不变。
type LoginGuard struct {
	cfg      config.Config
	mu       sync.Mutex
	attempts map[string]*loginAttempt
}

func NewLoginGuard(cfg config.Config) *LoginGuard {
	return &LoginGuard{cfg: cfg, attempts: make(map[string]*loginAttempt)}
}

func (g *LoginGuard) Check(username, ip string) LockState {
	key := attemptKey(username, ip)
	g.mu.Lock()
	defer g.mu.Unlock()
	entry, ok := g.attempts[key]
	if !ok {
		return LockState{}
	}
	now := time.Now()
	if !entry.LockedUntil.IsZero() {
		if entry.LockedUntil.After(now) {
			return LockState{
				Locked:     true,
				Failures:   entry.Failures,
				RetryAfter: int((entry.LockedUntil.Sub(now) + time.Second - 1) / time.Second),
			}
		}
		delete(g.attempts, key)
		return LockState{}
	}
	// 窗口从首次失败固定计算，过期后重新计数。
	if now.Sub(entry.FirstFailedAt) > g.cfg.LoginWindow {
		delete(g.attempts, key)
		return LockState{}
	}
	return LockState{Failures: entry.Failures}
}

func (g *LoginGuard) RecordFailure(username, ip string) LockState {
	key := attemptKey(username, ip)
	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	entry, ok := g.attempts[key]
	if !ok || now.Sub(entry.FirstFailedAt) > g.cfg.LoginWindow {
		entry = &loginAttempt{FirstFailedAt: now}
		g.attempts[key] = entry
	}
	entry.Failures++
	state := LockState{Failures: entry.Failures}
	if entry.Failures >= g.cfg.LoginMaxFailures {
		entry.LockedUntil = now.Add(g.cfg.LoginLock)
		state.Locked = true
		state.RetryAfter = int(g.cfg.LoginLock.Seconds())
	}
	return state
}

func (g *LoginGuard) Clear(username, ip string) {
	key := attemptKey(username, ip)
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.attempts, key)
}

func attemptKey(username, ip string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(username) + "\u0000" + ip))
	return hex.EncodeToString(sum[:])
}

/* ------------------------------ 登录 ------------------------------ */

type LoginResult struct {
	Token       string     `json:"token"`
	ExpiresAt   string     `json:"expiresAt"`
	User        PublicUser `json:"user"`
	Permissions []string   `json:"permissions"`
}

func Login(d Deps, username, password, ip, ua, scope string) (*LoginResult, error) {
	guard := d.LoginGuard
	if guard == nil {
		guard = NewLoginGuard(d.Cfg)
	}
	lock := guard.Check(username, ip)
	if lock.Locked {
		return nil, apperr.New(429, "too_many_attempts",
			d.I18N.Translate("error.too_many_attempts", "登录失败次数过多，请稍后再试",
				map[string]any{"RetryAfter": lock.RetryAfter}), map[string]any{"retryAfterSeconds": lock.RetryAfter})
	}

	// SQLite 的字符串比较区分大小写、MySQL 默认不区分，登录名匹配用 LOWER 统一语义，
	// 否则同一个账号在两种库上表现不同。
	var user model.User
	err := d.DB.Where("LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)", username, username).Take(&user).Error
	if err != nil || !passwd.Verify(password, user.PasswordHash) {
		state := guard.RecordFailure(username, ip)
		if state.Locked {
			_ = Audit(d, &Actor{IP: ip}, "登录锁定",
				map[string]string{"type": "user", "id": user.ID, "name": username},
				map[string]any{"failures": state.Failures, "lockedUntil": iso.Format(time.Now().Add(d.Cfg.LoginLock))})
		}
		return nil, apperr.New(401, "invalid_credentials", "账号或密码不正确")
	}
	if user.Status != "active" {
		return nil, apperr.New(403, "user_disabled", "该账号已被停用，请联系管理员")
	}
	// 只有控制台账号可登录后台；publisher 是 harness 侧身份（实例上
	// 开发/上传）。scope=oidc 是 harness SSO 登录路径，放开类型限制——
	// 用户中心所有账号都必须能登本地智能体。
	if scope != "oidc" && user.Kind != "" && user.Kind != "admin" {
		return nil, apperr.New(403, "not_console_user", "该账号是客户端身份，无控制台登录权限")
	}
	guard.Clear(username, ip)

	token, exp, err := NewSessionManager(d).Create(&user, ip, ua)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	d.DB.Model(&model.User{}).Where("id = ?", user.ID).Update("last_login_at", now)
	user.LastLoginAt = &now
	_ = Audit(d, &Actor{User: &user, IP: ip}, "登录",
		map[string]string{"type": "session", "id": user.ID, "name": "管理控制台"},
		map[string]any{"username": user.Username})

	return &LoginResult{
		Token: token, ExpiresAt: iso.Format(exp),
		User: ToPublicUser(&user), Permissions: EffectivePermissions(d, &user),
	}, nil
}

func decodeJSON(raw string, dst any) error {
	if raw == "" {
		return nil
	}
	return json.Unmarshal([]byte(raw), dst)
}
