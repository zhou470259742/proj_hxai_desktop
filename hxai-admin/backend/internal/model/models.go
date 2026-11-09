package model

import "time"

// 表结构与 legacy-node/src/db.mjs 对齐（SQLite → MySQL）。
// JSON 字段沿用 Node 版把数组/对象存成文本列的做法，迁移时按原值搬运。

type User struct {
	ID             string     `gorm:"column:id;type:varchar(40);primaryKey"`
	Username       string     `gorm:"column:username;type:varchar(80);not null;uniqueIndex:uk_users_username"`
	DisplayName    string     `gorm:"column:display_name;type:varchar(120);not null"`
	Email          *string    `gorm:"column:email;type:varchar(190)"`
	Department     *string    `gorm:"column:department;type:varchar(120)"`
	Role           string     `gorm:"column:role;type:varchar(20);not null;default:member"`
	Kind           string     `gorm:"column:kind;type:varchar(20);not null;default:console"`
	ExtraPermsJSON string     `gorm:"column:extra_perms_json;type:longtext"`
	Status         string     `gorm:"column:status;type:varchar(20);not null;default:active"`
	PasswordHash   string     `gorm:"column:password_hash;type:varchar(255);not null"`
	CreatedAt      time.Time  `gorm:"column:created_at;type:datetime(3);not null"`
	LastLoginAt    *time.Time `gorm:"column:last_login_at;type:datetime(3)"`
}

func (User) TableName() string { return "users" }

type Session struct {
	JTI       string    `gorm:"column:jti;type:varchar(64);primaryKey"`
	UserID    string    `gorm:"column:user_id;type:varchar(40);not null;index:idx_sessions_user"`
	CreatedAt time.Time `gorm:"column:created_at;type:datetime(3);not null"`
	ExpiresAt time.Time `gorm:"column:expires_at;type:datetime(3);not null"`
	Revoked   int       `gorm:"column:revoked;type:tinyint;not null;default:0"`
	IP        *string   `gorm:"column:ip;type:varchar(64)"`
	UserAgent *string   `gorm:"column:user_agent;type:varchar(255)"`
}

func (Session) TableName() string { return "sessions" }

type Plugin struct {
	ID               string    `gorm:"column:id;type:varchar(40);primaryKey"`
	Key              string    `gorm:"column:key;type:varchar(120);not null;uniqueIndex:uk_plugins_key"`
	Name             string    `gorm:"column:name;type:varchar(190);not null"`
	Summary          *string   `gorm:"column:summary;type:text"`
	Category         *string   `gorm:"column:category;type:varchar(80)"`
	Transport        string    `gorm:"column:transport;type:varchar(30);not null;default:streamable_http"`
	Endpoint         *string   `gorm:"column:endpoint;type:text"`
	Command          *string   `gorm:"column:command;type:text"`
	ArgsJSON         string    `gorm:"column:args_json;type:longtext"`
	AuthType         string    `gorm:"column:auth_type;type:varchar(20);not null;default:oauth"`
	AuthConfigJSON   string    `gorm:"column:auth_config_json;type:longtext"`
	Visibility       string    `gorm:"column:visibility;type:varchar(20);not null;default:all"`
	Version          *string   `gorm:"column:version;type:varchar(40)"`
	Status           string    `gorm:"column:status;type:varchar(20);not null;default:enabled;index:idx_plugins_status"`
	Owner            *string   `gorm:"column:owner;type:varchar(40)"`
	PackageFile      *string   `gorm:"column:package_file;type:varchar(190)"`
	PackageSHA256    *string   `gorm:"column:package_sha256;type:varchar(64)"`
	PackageSize      *int64    `gorm:"column:package_size;type:bigint"`
	DependenciesJSON string    `gorm:"column:dependencies_json;type:longtext"`
	CreatedAt        time.Time `gorm:"column:created_at;type:datetime(3);not null"`
	UpdatedAt        time.Time `gorm:"column:updated_at;type:datetime(3);not null"`
}

func (Plugin) TableName() string { return "plugins" }

type Skill struct {
	ID            string    `gorm:"column:id;type:varchar(40);primaryKey"`
	Key           string    `gorm:"column:key;type:varchar(120);not null;uniqueIndex:uk_skills_key"`
	Name          string    `gorm:"column:name;type:varchar(190);not null"`
	Summary       *string   `gorm:"column:summary;type:text"`
	Category      *string   `gorm:"column:category;type:varchar(80)"`
	Version       string    `gorm:"column:version;type:varchar(40);not null;default:1.0.0"`
	TriggerDesc   *string   `gorm:"column:trigger_desc;type:text"`
	Content       string    `gorm:"column:content;type:longtext;not null"`
	Status        string    `gorm:"column:status;type:varchar(20);not null;default:draft"`
	Author        *string   `gorm:"column:author;type:varchar(120)"`
	Installs      int       `gorm:"column:installs;type:int;not null;default:0"`
	PackageFile   *string   `gorm:"column:package_file;type:varchar(190)"`
	PackageSHA256 *string   `gorm:"column:package_sha256;type:varchar(64)"`
	PackageSize   *int64    `gorm:"column:package_size;type:bigint"`
	CreatedAt     time.Time `gorm:"column:created_at;type:datetime(3);not null"`
	UpdatedAt     time.Time `gorm:"column:updated_at;type:datetime(3);not null"`
}

func (Skill) TableName() string { return "skills" }

type Expert struct {
	ID             string    `gorm:"column:id;type:varchar(40);primaryKey"`
	Key            string    `gorm:"column:key;type:varchar(120);not null;uniqueIndex:uk_experts_key"`
	Name           string    `gorm:"column:name;type:varchar(190);not null"`
	RoleTitle      *string   `gorm:"column:role_title;type:varchar(190)"`
	Emoji          *string   `gorm:"column:emoji;type:varchar(16)"`
	Summary        *string   `gorm:"column:summary;type:text"`
	RolePrompt     string    `gorm:"column:role_prompt;type:longtext;not null"`
	Version        string    `gorm:"column:version;type:varchar(40);not null;default:1.0.0"`
	ModelProvider  *string   `gorm:"column:model_provider;type:varchar(80)"`
	ModelName      *string   `gorm:"column:model_name;type:varchar(80)"`
	Permission     string    `gorm:"column:permission_mode;type:varchar(30);not null;default:confirm_write"`
	PluginIDsJSON  string    `gorm:"column:plugin_ids_json;type:longtext"`
	SkillIDsJSON   string    `gorm:"column:skill_ids_json;type:longtext"`
	MarketMetaJSON string    `gorm:"column:market_meta_json;type:longtext"`
	Visibility     string    `gorm:"column:visibility;type:varchar(20);not null;default:all"`
	Status         string    `gorm:"column:status;type:varchar(20);not null;default:draft;index:idx_experts_status"`
	Owner          *string   `gorm:"column:owner;type:varchar(40)"`
	CreatedAt      time.Time `gorm:"column:created_at;type:datetime(3);not null"`
	UpdatedAt      time.Time `gorm:"column:updated_at;type:datetime(3);not null"`
}

func (Expert) TableName() string { return "experts" }

type Grant struct {
	ID          string    `gorm:"column:id;type:varchar(40);primaryKey"`
	ExpertID    string    `gorm:"column:expert_id;type:varchar(40);not null;index:idx_grants_expert"`
	SubjectType string    `gorm:"column:subject_type;type:varchar(20);not null"`
	SubjectID   string    `gorm:"column:subject_id;type:varchar(120);not null"`
	CreatedAt   time.Time `gorm:"column:created_at;type:datetime(3);not null"`
}

func (Grant) TableName() string { return "grants" }

type AuditLog struct {
	ID         uint64    `gorm:"column:id;type:bigint unsigned;primaryKey;autoIncrement"`
	ActorID    *string   `gorm:"column:actor_id;type:varchar(40)"`
	ActorName  *string   `gorm:"column:actor_name;type:varchar(120)"`
	Action     string    `gorm:"column:action;type:varchar(120);not null"`
	TargetType *string   `gorm:"column:target_type;type:varchar(40)"`
	TargetID   *string   `gorm:"column:target_id;type:varchar(64)"`
	TargetName *string   `gorm:"column:target_name;type:varchar(190)"`
	DetailJSON string    `gorm:"column:detail_json;type:longtext"`
	IP         *string   `gorm:"column:ip;type:varchar(64)"`
	CreatedAt  time.Time `gorm:"column:created_at;type:datetime(3);not null;index:idx_audit_created,sort:desc"`
	PrevHash   *string   `gorm:"column:prev_hash;type:varchar(64)"`
	Hash       *string   `gorm:"column:hash;type:varchar(64)"`
}

func (AuditLog) TableName() string { return "audit_logs" }

// AuditChainHead 是 Go 版新增的单行链表头：审计写入在事务里锁这一行，
// 保证多实例并发追加时 prev_hash 不会分叉（SQLite 版靠库级写锁天然串行）。
type AuditChainHead struct {
	ID   int    `gorm:"column:id;type:int;primaryKey"`
	Hash string `gorm:"column:hash;type:varchar(64);not null"`
}

func (AuditChainHead) TableName() string { return "audit_chain_head" }

type Handoff struct {
	Grant      string     `gorm:"column:grant;type:varchar(64);primaryKey"`
	UserID     string     `gorm:"column:user_id;type:varchar(40);not null"`
	CreatedAt  time.Time  `gorm:"column:created_at;type:datetime(3);not null"`
	ExpiresAt  time.Time  `gorm:"column:expires_at;type:datetime(3);not null"`
	ConsumedAt *time.Time `gorm:"column:consumed_at;type:datetime(3)"`
	IP         *string    `gorm:"column:ip;type:varchar(64)"`
}

func (Handoff) TableName() string { return "handoffs" }

type Setting struct {
	Key   string  `gorm:"column:key;type:varchar(120);primaryKey"`
	Value *string `gorm:"column:value;type:longtext"`
}

func (Setting) TableName() string { return "settings" }

type ClientToken struct {
	ID        string    `gorm:"column:id;type:varchar(40);primaryKey"`
	Label     string    `gorm:"column:label;type:varchar(120);not null"`
	TokenHash string    `gorm:"column:token_hash;type:varchar(64);not null;uniqueIndex:uk_client_tokens_hash"`
	CreatedAt time.Time `gorm:"column:created_at;type:datetime(3);not null"`
	CreatedBy *string   `gorm:"column:created_by;type:varchar(40)"`
	Revoked   int       `gorm:"column:revoked;type:tinyint;not null;default:0"`
}

func (ClientToken) TableName() string { return "client_tokens" }

// OAuthClient 是 OIDC/OAuth 授权客户端登记：每个对接方（如 Octop 实例的 sso_oidc）
// 登记一行；secret 存 SHA-256 hex，公共客户端可留空走纯 PKCE。
type OAuthClient struct {
	ID           string    `gorm:"column:id;type:varchar(40);primaryKey"`
	ClientID     string    `gorm:"column:client_id;type:varchar(120);not null;uniqueIndex:uk_oauth_clients_id"`
	Name         string    `gorm:"column:name;type:varchar(190);not null"`
	SecretHash   *string   `gorm:"column:secret_hash;type:varchar(128)"`
	RedirectURIs string    `gorm:"column:redirect_uris;type:longtext;not null;default:'[]'"`
	Status       string    `gorm:"column:status;type:varchar(20);not null;default:enabled"`
	CreatedAt    time.Time `gorm:"column:created_at;type:datetime(3);not null"`
}

func (OAuthClient) TableName() string { return "oauth_clients" }

// Instance 是一台已登记的 Octop 实例：admin 用它做跨实例用户/运行态聚合。
// AdminToken 是实例管理员 JWT（v1 简化存明文，后续应接实例 API key）。
type Instance struct {
	ID         string     `gorm:"column:id;type:varchar(40);primaryKey" json:"id"`
	Name       string     `gorm:"column:name;type:varchar(190);not null" json:"name"`
	BaseURL    string     `gorm:"column:base_url;type:varchar(300);not null" json:"baseUrl"`
	AdminToken string     `gorm:"column:admin_token;type:longtext;not null" json:"-"`
	LastSeenAt *time.Time `gorm:"column:last_seen_at;type:datetime(3)" json:"lastSeenAt"`
	LastError  *string    `gorm:"column:last_error;type:varchar(500)" json:"lastError"`
	CreatedAt  time.Time  `gorm:"column:created_at;type:datetime(3);not null" json:"createdAt"`
}

func (Instance) TableName() string { return "instances" }

// Role 是管理端角色：一组权限键（service/rbac.go 目录）+ 展示信息。
// users.role 存角色 ID；内置角色（admin/publisher/member）不可删，
// admin 角色在代码层恒为全量权限（与 Octop is_admin 语义一致）。
type Role struct {
	ID          string    `gorm:"column:id;type:varchar(40);primaryKey"`
	Name        string    `gorm:"column:name;type:varchar(80);not null"`
	NameEn      string    `gorm:"column:name_en;type:varchar(80);not null;default:''"`
	Description string    `gorm:"column:description;type:varchar(190);not null;default:''"`
	Builtin     int       `gorm:"column:builtin;type:tinyint;not null;default:0"`
	Domain      string    `gorm:"column:domain;type:varchar(20);not null;default:console"`
	Permissions string    `gorm:"column:permissions;type:longtext"` // JSON array of permission keys
	CreatedAt   time.Time `gorm:"column:created_at;type:datetime(3);not null"`
	UpdatedAt   time.Time `gorm:"column:updated_at;type:datetime(3);not null"`
}

func (Role) TableName() string { return "roles" }
