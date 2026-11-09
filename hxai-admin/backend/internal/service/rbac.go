package service

import (
	"encoding/json"
	"sort"
	"time"

	"fmt"
	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/ids"
	"gorm.io/gorm"
	"strings"
)

// 管理端权限目录，仿 Octop 模块键模型：一个键 = 一类模块的管理能力，
// *_delete 是独立的删除动作键（Octop 里 publisher 角色同样不能删内容）。
// admin 角色不按表判权，代码层恒为全量（等同 Octop is_admin bypass）。
type PermissionDef struct {
	Key      string `json:"key"`
	Category string `json:"category"` // nav | content | governance | system
	LabelZh  string `json:"labelZh"`
	LabelEn  string `json:"labelEn"`
}

var permissionCatalog = []PermissionDef{
	{Key: "overview", Category: "nav", LabelZh: "概览", LabelEn: "Overview"},
	// 模块键 = 该域全量（查看+全部动作，兼容存量角色）；模块_动作 = 仅该动作。
	{Key: "experts", Category: "content", LabelZh: "专家管理", LabelEn: "Experts"},
	{Key: "experts_create", Category: "content", LabelZh: "新建专家", LabelEn: "Create expert"},
	{Key: "experts_edit", Category: "content", LabelZh: "编辑专家", LabelEn: "Edit expert"},
	{Key: "experts_delete", Category: "content", LabelZh: "删除专家", LabelEn: "Delete experts"},
	{Key: "plugins", Category: "content", LabelZh: "插件管理", LabelEn: "Plugins"},
	{Key: "plugins_create", Category: "content", LabelZh: "新建插件", LabelEn: "Create plugin"},
	{Key: "plugins_edit", Category: "content", LabelZh: "编辑插件", LabelEn: "Edit plugin"},
	{Key: "plugins_delete", Category: "content", LabelZh: "删除插件", LabelEn: "Delete plugins"},
	{Key: "skills", Category: "content", LabelZh: "技能商城", LabelEn: "Skills"},
	{Key: "skills_create", Category: "content", LabelZh: "新建技能", LabelEn: "Create skill"},
	{Key: "skills_edit", Category: "content", LabelZh: "编辑技能", LabelEn: "Edit skill"},
	{Key: "skills_delete", Category: "content", LabelZh: "删除技能", LabelEn: "Delete skills"},
	{Key: "users", Category: "governance", LabelZh: "用户管理", LabelEn: "User management"},
	{Key: "users_create", Category: "governance", LabelZh: "新建用户", LabelEn: "Create user"},
	{Key: "users_edit", Category: "governance", LabelZh: "编辑用户", LabelEn: "Edit user"},
	{Key: "users_delete", Category: "governance", LabelZh: "删除用户", LabelEn: "Delete user"},
	{Key: "roles", Category: "governance", LabelZh: "角色管理", LabelEn: "Roles"},
	{Key: "roles_create", Category: "governance", LabelZh: "新建角色", LabelEn: "Create role"},
	{Key: "roles_edit", Category: "governance", LabelZh: "编辑角色", LabelEn: "Edit role"},
	{Key: "roles_delete", Category: "governance", LabelZh: "删除角色", LabelEn: "Delete role"},
	{Key: "audit", Category: "governance", LabelZh: "审计日志", LabelEn: "Audit log"},
	{Key: "instances", Category: "governance", LabelZh: "实例管理", LabelEn: "Instances"},
	{Key: "instances_create", Category: "governance", LabelZh: "登记实例", LabelEn: "Register instance"},
	{Key: "instances_delete", Category: "governance", LabelZh: "删除实例", LabelEn: "Delete instance"},
	{Key: "client_config", Category: "governance", LabelZh: "客户端配置", LabelEn: "Client config"},
	{Key: "client_config_edit", Category: "governance", LabelZh: "修改客户端配置", LabelEn: "Edit client config"},
	{Key: "oidc_clients", Category: "system", LabelZh: "OIDC 应用", LabelEn: "OIDC clients"},
	{Key: "oidc_clients_edit", Category: "system", LabelZh: "管理 OIDC 应用", LabelEn: "Manage OIDC clients"},
	{Key: "settings", Category: "system", LabelZh: "系统设置", LabelEn: "Settings"},
	{Key: "settings_edit", Category: "system", LabelZh: "修改系统设置", LabelEn: "Edit settings"},
}

var permissionKeys = func() map[string]PermissionDef {
	out := make(map[string]PermissionDef, len(permissionCatalog))
	for _, def := range permissionCatalog {
		out[def.Key] = def
	}
	return out
}()

const (
	RoleIDAdmin     = "admin"
	RoleIDPublisher = "publisher"
	RoleIDMember    = "member"
)

func allPermissionKeys() []string {
	keys := make([]string, 0, len(permissionCatalog))
	for _, def := range permissionCatalog {
		keys = append(keys, def.Key)
	}
	return keys
}

// PermissionCatalog 返回给角色编辑器的完整目录。
func PermissionCatalog() []PermissionDef {
	return append([]PermissionDef(nil), permissionCatalog...)
}

// IsAdminRole 与 Octop 一致：admin 恒为全量权限，不走表判权，
// 角色管理页也无法把 admin 改成残血——防止把自己锁死。
func IsAdminRole(role string) bool { return role == RoleIDAdmin }

func decodePermissions(raw string) []string {
	var keys []string
	if err := json.Unmarshal([]byte(raw), &keys); err != nil {
		return nil
	}
	return keys
}

func encodePermissions(keys []string) string {
	data, _ := json.Marshal(keys)
	return string(data)
}

// ValidatePermissions 去重并拒绝未知键。
func ValidatePermissions(keys []string) ([]string, error) {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		def, ok := permissionKeys[key]
		if !ok {
			return nil, apperr.Bad("未知权限项：" + key)
		}
		if _, dup := seen[def.Key]; dup {
			continue
		}
		seen[def.Key] = struct{}{}
		out = append(out, def.Key)
	}
	return out, nil
}

// rolePermissionSet 读某角色的权限键集合；角色不存在视为空集。
func rolePermissionSet(db *gorm.DB, roleID string) map[string]struct{} {
	var row model.Role
	if err := db.Where("id = ?", roleID).Take(&row).Error; err != nil {
		return nil
	}
	out := map[string]struct{}{}
	for _, key := range decodePermissions(row.Permissions) {
		out[key] = struct{}{}
	}
	return out
}

// HasPermission 判某用户是否持有权限键；admin bypass，未知键恒拒。
func HasPermission(d Deps, user *model.User, key string) bool {
	if user == nil {
		return false
	}
	if _, ok := permissionKeys[key]; !ok {
		return false
	}
	if IsAdminRole(user.Role) {
		return true
	}
	_, ok := rolePermissionSet(d.DB, user.Role)[key]
	return ok
}

// ValidUserKinds 用户种类：console=控制台账号，publisher=harness 侧发布者。
var ValidUserKinds = map[string]bool{"admin": true, "user": true}

// ValidateExtraPerms 校验 per-user 额外权限键是否都在目录内。
func ValidateExtraPerms(perms []string) error {
	for _, k := range perms {
		if _, ok := permissionKeys[k]; !ok {
			return fmt.Errorf("未知权限键：%s", k)
		}
	}
	return nil
}

// ActionKey 模块动作键 = 模块_动作（create/edit/delete）。
func ActionKey(module, action string) string { return module + "_" + action }

// hasModuleView 任何 module_* 键视作对该域有「查看」能力（页面可见性）。
func hasModuleView(set map[string]struct{}, module string) bool {
	if _, ok := set[module]; ok {
		return true
	}
	for k := range set {
		if strings.HasPrefix(k, module+"_") {
			return true
		}
	}
	return false
}

// hasModuleAction 模块键=该域全量（兼容存量角色）；模块_动作=仅该动作。
func hasModuleAction(set map[string]struct{}, module, action string) bool {
	if _, ok := set[module]; ok {
		return true
	}
	_, ok := set[ActionKey(module, action)]
	return ok
}

// HasModulePerm 动作级判权：GET/HEAD→查看（module 或任一 module_*），
// POST→_create，PUT/PATCH→_edit，DELETE→_delete。模块键=该域全量（兼容
// 存量角色）；admin bypass。
func HasModulePerm(d Deps, user *model.User, module, method string) bool {
	if user == nil {
		return false
	}
	if IsAdminRole(user.Role) {
		return true
	}
	set := rolePermissionSet(d.DB, user.Role)
	for _, k := range parseStringArray(user.ExtraPermsJSON) {
		if _, ok := permissionKeys[k]; ok {
			set[k] = struct{}{}
		}
	}
	switch method {
	case "GET", "HEAD", "OPTIONS":
		return hasModuleView(set, module)
	case "POST":
		return hasModuleAction(set, module, "create")
	case "PUT", "PATCH":
		return hasModuleAction(set, module, "edit")
	case "DELETE":
		return hasModuleAction(set, module, "delete")
	}
	return false
}

// EffectivePermissions 返回用户生效权限键（/api/auth/me 给前端做菜单门控）。
func EffectivePermissions(d Deps, user *model.User) []string {
	if user == nil {
		return nil
	}
	if IsAdminRole(user.Role) {
		return allPermissionKeys()
	}
	set := rolePermissionSet(d.DB, user.Role)
	// per-user 额外授予（octop 同款 role + extra 模型）
	for _, k := range parseStringArray(user.ExtraPermsJSON) {
		if _, ok := permissionKeys[k]; ok {
			set[k] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

// RoleExists 供用户管理在指派角色前校验。
func RoleExists(d Deps, roleID string) bool {
	var count int64
	d.DB.Model(&model.Role{}).Where("id = ?", roleID).Count(&count)
	return count > 0
}

type RoleView struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	NameEn      string   `json:"nameEn"`
	Description string   `json:"description"`
	Domain      string   `json:"domain"`
	Builtin     bool     `json:"builtin"`
	Permissions []string `json:"permissions"`
	UserCount   int64    `json:"userCount"`
}

func toRoleView(row *model.Role, userCount map[string]int64) RoleView {
	return RoleView{
		ID:          row.ID,
		Name:        row.Name,
		NameEn:      row.NameEn,
		Description: row.Description,
		Builtin:     row.Builtin != 0,
		Domain:      roleDomain(row),
		Permissions: decodePermissions(row.Permissions),
		UserCount:   userCount[row.ID],
	}
}

func ListRoles(d Deps) ([]RoleView, error) {
	var rows []model.Role
	if err := d.DB.Order("builtin DESC, created_at ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	counts := map[string]int64{}
	var grouped []struct {
		Role  string
		Total int64
	}
	if err := d.DB.Model(&model.User{}).Select("role, COUNT(*) AS total").Group("role").Find(&grouped).Error; err != nil {
		return nil, err
	}
	for _, g := range grouped {
		counts[g.Role] = g.Total
	}
	views := make([]RoleView, 0, len(rows))
	for i := range rows {
		views = append(views, toRoleView(&rows[i], counts))
	}
	return views, nil
}

type RoleInput struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	NameEn      string   `json:"nameEn"`
	Description string   `json:"description"`
	Domain      string   `json:"domain"`
	Permissions []string `json:"permissions"`
}

func CreateRole(d Deps, actor *Actor, in RoleInput) (*RoleView, error) {
	if in.Name == "" {
		return nil, apperr.Bad("缺少必填字段：角色名称")
	}
	domain := in.Domain
	if domain == "" {
		domain = "console"
	}
	if domain != "console" && domain != "harness" {
		return nil, apperr.Bad("未知角色域：" + domain)
	}
	var keys []string
	var err error
	if domain == "harness" {
		keys, err = ValidateHarnessPermissions(d, in.Permissions)
		if err != nil {
			return nil, err
		}
	} else {
		keys, err = ValidatePermissions(in.Permissions)
		if err != nil {
			return nil, err
		}
	}
	role := model.Role{
		ID:          ids.New("rol"),
		Name:        in.Name,
		NameEn:      in.NameEn,
		Description: in.Description,
		Domain:      domain,
		Permissions: encodePermissions(keys),
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if err := d.DB.Create(&role).Error; err != nil {
		return nil, err
	}
	_ = Audit(d, actor, "新增角色",
		map[string]string{"type": "role", "id": role.ID, "name": role.Name},
		map[string]any{"permissions": keys})
	view := toRoleView(&role, nil)
	return &view, nil
}

func UpdateRole(d Deps, actor *Actor, id string, in RoleInput) (*RoleView, error) {
	var role model.Role
	if err := d.DB.Where("id = ?", id).Take(&role).Error; err != nil {
		return nil, apperr.NotFound("角色不存在")
	}
	if role.ID == RoleIDAdmin {
		return nil, apperr.Bad("内置管理员角色不可修改")
	}
	var keys []string
	var err error
	if role.Domain == "harness" {
		keys, err = ValidateHarnessPermissions(d, in.Permissions)
	} else {
		keys, err = ValidatePermissions(in.Permissions)
	}
	if err != nil {
		return nil, err
	}
	if in.Name != "" {
		role.Name = in.Name
	}
	role.NameEn = in.NameEn
	role.Description = in.Description
	role.Permissions = encodePermissions(keys)
	role.UpdatedAt = time.Now().UTC()
	if err := d.DB.Save(&role).Error; err != nil {
		return nil, err
	}
	_ = Audit(d, actor, "更新角色",
		map[string]string{"type": "role", "id": role.ID, "name": role.Name},
		map[string]any{"permissions": keys})
	view := toRoleView(&role, nil)
	return &view, nil
}

func DeleteRole(d Deps, actor *Actor, id string) error {
	var role model.Role
	if err := d.DB.Where("id = ?", id).Take(&role).Error; err != nil {
		return apperr.NotFound("角色不存在")
	}
	if role.Builtin != 0 {
		return apperr.Bad("内置角色不可删除")
	}
	var count int64
	d.DB.Model(&model.User{}).Where("role = ?", role.ID).Count(&count)
	if count > 0 {
		return apperr.Conflict("仍有用户绑定该角色，无法删除")
	}
	if err := d.DB.Where("id = ?", role.ID).Delete(&model.Role{}).Error; err != nil {
		return err
	}
	_ = Audit(d, actor, "删除角色",
		map[string]string{"type": "role", "id": role.ID, "name": role.Name}, nil)
	return nil
}

// SeedBuiltinRoles 补建缺失的内置角色行（幂等）：已存在的行原样保留，
// 管理员对 publisher/member 权限的自定义不被启动覆盖。
func SeedBuiltinRoles(d Deps) error {
	builtins := []model.Role{
		{
			ID: RoleIDAdmin, Name: "管理员", NameEn: "Admin",
			Description: "拥有完整权限且不受资源策略限制。",
			Builtin:     1, Permissions: encodePermissions(allPermissionKeys()),
		},
		{
			ID: RoleIDPublisher, Name: "发布者", NameEn: "Publisher",
			Description: "管理专家、插件、技能与客户端配置，不含删除与治理权限。",
			Builtin:     1,
			Permissions: encodePermissions([]string{"experts", "plugins", "skills", "client_config"}),
		},
		{
			ID: RoleIDMember, Name: "成员", NameEn: "Member",
			Description: "基础成员，仅可登录与查看概览。",
			Builtin:     1, Permissions: encodePermissions([]string{"overview"}),
		},
	}
	for i := range builtins {
		var count int64
		if err := d.DB.Model(&model.Role{}).Where("id = ?", builtins[i].ID).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		builtins[i].CreatedAt = time.Now().UTC()
		builtins[i].UpdatedAt = time.Now().UTC()
		if err := d.DB.Create(&builtins[i]).Error; err != nil {
			return err
		}
	}
	return nil
}

func roleDomain(row *model.Role) string {
	if row.Domain == "" {
		return "console"
	}
	return row.Domain
}

// roleBelongsToDomain 用户指派校验：admin 用户只能绑 console 域角色，
// user（harness 侧）只能绑 harness 域角色。
func roleBelongsToDomain(d Deps, roleID, kind string) bool {
	var r model.Role
	if err := d.DB.Where("id = ?", roleID).Take(&r).Error; err != nil {
		return false
	}
	return roleDomain(&r) == map[string]string{"admin": "console", "user": "harness"}[kind]
}
