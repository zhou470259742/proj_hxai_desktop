package service

import (
	"time"

	"crypto/rand"
	"github.com/hx/control-plane/internal/model"
	"github.com/hx/control-plane/internal/platform/apperr"
	"github.com/hx/control-plane/internal/platform/ids"
	"github.com/hx/control-plane/internal/platform/passwd"
	"gorm.io/gorm"
)

type UserListItem struct {
	PublicUser
}

func ListUsers(d Deps, actor *model.User) ([]UserListItem, error) {
	_ = actor
	var users []model.User
	if err := d.DB.Order("created_at ASC").Find(&users).Error; err != nil {
		return nil, err
	}
	items := make([]UserListItem, 0, len(users))
	for i := range users {
		items = append(items, UserListItem{PublicUser: ToPublicUser(&users[i])})
	}
	return items, nil
}

type CreateUserInput struct {
	Username    string   `json:"username"`
	DisplayName string   `json:"displayName"`
	Email       string   `json:"email"`
	Department  string   `json:"department"`
	Role        string   `json:"role"`
	Kind        string   `json:"kind"`
	ExtraPerms  []string `json:"extraPerms"`
	Status      string   `json:"status"`
	Password    string   `json:"password"`
}

func CreateUser(d Deps, actor *Actor, in CreateUserInput) (*PublicUser, error) {
	missing := missingFields(map[string]string{
		"username": in.Username, "displayName": in.DisplayName, "password": in.Password,
	})
	if len(missing) > 0 {
		return nil, apperr.Bad("缺少必填字段："+joinFields(missing), map[string]any{"missing": missing})
	}
	var exists int64
	// 与登录保持一致：两种数据库都按大小写不敏感判重。
	d.DB.Model(&model.User{}).Where("LOWER(username) = LOWER(?)", in.Username).Count(&exists)
	if exists > 0 {
		return nil, apperr.Conflict("用户名已存在")
	}
	if len(in.Password) < 8 {
		return nil, apperr.Bad("密码至少 8 位")
	}
	hash, err := passwd.Hash(in.Password)
	if err != nil {
		return nil, err
	}
	roleKind := in.Kind
	if roleKind == "" {
		roleKind = "admin"
	}
	role := in.Role
	if role == "" {
		// 未指定角色：普通用户回退「默认注册角色」设置（单体注册场景），
		// 管理员回退 member。
		if roleKind == "user" {
			role = d.Settings.Get("default_register_role", "")
		}
		if role == "" {
			role = "member"
		}
	}
	if !RoleExists(d, role) {
		return nil, apperr.Bad("角色不存在：" + role)
	}
	if !roleBelongsToDomain(d, role, roleKind) {
		return nil, apperr.Bad("角色域与用户类型不匹配：" + role)
	}
	status := in.Status
	if status == "" {
		status = "active"
	}
	kind := in.Kind
	if kind == "" {
		kind = "admin"
	}
	if !ValidUserKinds[kind] {
		return nil, apperr.Bad("未知用户类型：" + kind)
	}
	if err := ValidateExtraPerms(in.ExtraPerms); err != nil {
		return nil, apperr.Bad(err.Error())
	}
	user := model.User{
		ID:             ids.New("usr"),
		Username:       in.Username,
		DisplayName:    in.DisplayName,
		Email:          optString(in.Email),
		Department:     optString(in.Department),
		Role:           role,
		Kind:           kind,
		ExtraPermsJSON: marshalStringArray(in.ExtraPerms),
		Status:         status,
		PasswordHash:   hash,
		CreatedAt:      time.Now().UTC(),
	}
	if err := d.DB.Create(&user).Error; err != nil {
		return nil, err
	}
	_ = Audit(d, actor, "新增用户",
		map[string]string{"type": "user", "id": user.ID, "name": user.DisplayName},
		map[string]any{"department": in.Department, "role": in.Role})
	result := ToPublicUser(&user)
	return &result, nil
}

type UpdateUserInput struct {
	DisplayName *string   `json:"displayName"`
	Email       *string   `json:"email"`
	Department  *string   `json:"department"`
	Role        *string   `json:"role"`
	Kind        *string   `json:"kind"`
	ExtraPerms  *[]string `json:"extraPerms"`
	Status      *string   `json:"status"`
	Password    *string   `json:"password"`
}

func UpdateUser(d Deps, actor *Actor, id string, in UpdateUserInput) (*PublicUser, error) {
	var user model.User
	if err := d.DB.Where("id = ?", id).Take(&user).Error; err != nil {
		return nil, apperr.NotFound("用户不存在")
	}
	if user.ID == actor.User.ID && in.Status != nil && *in.Status == "disabled" {
		return nil, apperr.Bad("不能停用当前登录账号")
	}
	if in.DisplayName != nil {
		user.DisplayName = *in.DisplayName
	}
	if in.Email != nil {
		user.Email = optString(*in.Email)
	}
	if in.Department != nil {
		user.Department = optString(*in.Department)
	}
	if in.Role != nil {
		if !RoleExists(d, *in.Role) {
			return nil, apperr.Bad("角色不存在：" + *in.Role)
		}
		if !roleBelongsToDomain(d, *in.Role, user.Kind) {
			return nil, apperr.Bad("角色域与用户类型不匹配：" + *in.Role)
		}
		user.Role = *in.Role
	}
	if in.Status != nil {
		if in.Kind != nil {
			if !ValidUserKinds[*in.Kind] {
				return nil, apperr.Bad("未知用户类型：" + *in.Kind)
			}
			user.Kind = *in.Kind
		}
		if in.ExtraPerms != nil {
			if err := ValidateExtraPerms(*in.ExtraPerms); err != nil {
				return nil, apperr.Bad(err.Error())
			}
			user.ExtraPermsJSON = marshalStringArray(*in.ExtraPerms)
		}
		user.Status = *in.Status
	}
	err := d.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&user).Error; err != nil {
			return err
		}
		if in.Password != nil && *in.Password != "" {
			hash, err := passwd.Hash(*in.Password)
			if err != nil {
				return err
			}
			if err := tx.Model(&model.User{}).Where("id = ?", user.ID).Update("password_hash", hash).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.Session{}).Where("user_id = ?", user.ID).Update("revoked", 1).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if in.Password != nil && *in.Password != "" {
		NewSessionManager(d).RevokeAllForUser(user.ID)
	}
	_ = Audit(d, actor, "更新用户",
		map[string]string{"type": "user", "id": user.ID, "name": user.DisplayName},
		map[string]any{"role": user.Role, "status": user.Status})
	result := ToPublicUser(&user)
	return &result, nil
}

func DeleteUser(d Deps, actor *Actor, id string) error {
	var user model.User
	if err := d.DB.Where("id = ?", id).Take(&user).Error; err != nil {
		return apperr.NotFound("用户不存在")
	}
	if user.ID == actor.User.ID {
		return apperr.Bad("不能删除当前登录账号")
	}
	err := d.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", user.ID).Delete(&model.Session{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", user.ID).Delete(&model.Handoff{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", user.ID).Delete(&model.User{}).Error
	})
	if err != nil {
		return err
	}
	NewSessionManager(d).RevokeAllForUser(user.ID)
	_ = Audit(d, actor, "删除用户",
		map[string]string{"type": "user", "id": user.ID, "name": user.DisplayName}, nil)
	return nil
}

func ChangePassword(d Deps, actor *model.User, ip, oldPassword, newPassword string) error {
	var user model.User
	if err := d.DB.Where("id = ?", actor.ID).Take(&user).Error; err != nil {
		return apperr.NotFound("用户不存在")
	}
	if !passwd.Verify(oldPassword, user.PasswordHash) {
		return apperr.Bad("原密码不正确")
	}
	if len(newPassword) < 8 {
		return apperr.Bad("新密码至少 8 位")
	}
	hash, err := passwd.Hash(newPassword)
	if err != nil {
		return err
	}
	if err := d.DB.Model(&model.User{}).Where("id = ?", user.ID).Update("password_hash", hash).Error; err != nil {
		return err
	}
	d.DB.Model(&model.Session{}).Where("user_id = ?", user.ID).Update("revoked", 1)
	NewSessionManager(d).RevokeAllForUser(user.ID)
	return Audit(d, &Actor{User: &user, IP: ip}, "修改密码",
		map[string]string{"type": "user", "id": user.ID, "name": user.DisplayName}, nil)
}

func optString(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func missingFields(fields map[string]string) []string {
	var missing []string
	for name, value := range fields {
		if value == "" {
			missing = append(missing, name)
		}
	}
	return missing
}

func joinFields(fields []string) string {
	out := ""
	for i, field := range fields {
		if i > 0 {
			out += "、"
		}
		out += field
	}
	return out
}

// UserStatusForSync 给实例侧的禁用同步：返回 [{id,status}]，id 即 OIDC sub（user.ID）。
func UserStatusForSync(d Deps) []map[string]string {
	users := []model.User{}
	if err := d.DB.Select("id", "status").Find(&users).Error; err != nil {
		return nil
	}
	items := make([]map[string]string, 0, len(users))
	for _, u := range users {
		items = append(items, map[string]string{"id": u.ID, "status": u.Status})
	}
	return items
}

// ResetUserPassword 管理员重置密码：生成一次性临时密码、吊销全部会话、
// 留审计，明文只在响应里出现一次供管理员转交。
func ResetUserPassword(d Deps, actor *Actor, id string) (string, error) {
	var user model.User
	if err := d.DB.Where("id = ?", id).Take(&user).Error; err != nil {
		return "", apperr.NotFound("用户不存在")
	}
	tmp := generateTempPassword()
	hash, err := passwd.Hash(tmp)
	if err != nil {
		return "", err
	}
	if err := d.DB.Model(&model.User{}).Where("id = ?", user.ID).
		Update("password_hash", hash).Error; err != nil {
		return "", err
	}
	NewSessionManager(d).RevokeAllForUser(user.ID)
	_ = Audit(d, actor, "重置用户密码",
		map[string]string{"type": "user", "id": user.ID, "name": user.Username}, nil)
	return tmp, nil
}

// SyncUserPassword 实例回推：sso 用户本地改密码 → 中心端同步写 hash +
// 吊销全部会话。subject = 实例侧 sso_subject = user.ID。
func SyncUserPassword(d Deps, subject, password string) error {
	var user model.User
	if err := d.DB.Where("id = ?", subject).Take(&user).Error; err != nil {
		return apperr.NotFound("用户不存在")
	}
	hash, err := passwd.Hash(password)
	if err != nil {
		return err
	}
	if err := d.DB.Model(&model.User{}).Where("id = ?", user.ID).
		Update("password_hash", hash).Error; err != nil {
		return err
	}
	NewSessionManager(d).RevokeAllForUser(user.ID)
	_ = Audit(d, nil, "实例回推密码",
		map[string]string{"type": "user", "id": user.ID, "name": user.Username}, nil)
	return nil
}

// SyncUpsertUser 实例回推的用户 upsert：不存在则按 kind=user 建档
// （role 空 → default_register_role 兜底），已存在则按需更新
// 显示名/密码并吊销会话。
func SyncUpsertUser(d Deps, username, displayName, password string) (*model.User, error) {
	var user model.User
	err := d.DB.Where("username = ?", username).Take(&user).Error
	if err != nil {
		name := displayName
		if name == "" {
			name = username
		}
		created, cerr := CreateUser(d, nil, CreateUserInput{
			Username: username, DisplayName: name,
			Password: password, Kind: "user",
		})
		if cerr != nil {
			return nil, cerr
		}
		_ = Audit(d, nil, "实例回推建档",
			map[string]string{"type": "user", "id": created.ID, "name": username}, nil)
		if err := d.DB.Where("id = ?", created.ID).Take(&user).Error; err != nil {
			return nil, err
		}
		return &user, nil
	}
	updates := map[string]any{}
	if displayName != "" && displayName != user.DisplayName {
		updates["display_name"] = displayName
	}
	if password != "" {
		hash, herr := passwd.Hash(password)
		if herr != nil {
			return nil, herr
		}
		updates["password_hash"] = hash
	}
	if len(updates) > 0 {
		if err := d.DB.Model(&model.User{}).Where("id = ?", user.ID).Updates(updates).Error; err != nil {
			return nil, err
		}
		if _, ok := updates["password_hash"]; ok {
			NewSessionManager(d).RevokeAllForUser(user.ID)
		}
		_ = Audit(d, nil, "实例回推更新",
			map[string]string{"type": "user", "id": user.ID, "name": username}, updates)
	}
	return &user, nil
}

// generateTempPassword 一次性临时密码：12 位，易读字符集（去 0O/1l 歧义）。
func generateTempPassword() string {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	buf := make([]byte, 12)
	rnd := make([]byte, 12)
	if _, err := rand.Read(rnd); err == nil {
		for i := range buf {
			buf[i] = alphabet[rnd[i]%byte(len(alphabet))]
		}
		return string(buf)
	}
	return ids.New("tmp")
}

// VerifyUserCredentials 实例代理登录验证：中心端校验用户名+密码，
// 成功返回 JIT reconcile 所需的 claims（OIDC claims 同形）。
func VerifyUserCredentials(d Deps, username, password string) (map[string]any, error) {
	var user model.User
	if err := d.DB.Where("username = ?", username).Take(&user).Error; err != nil {
		return nil, apperr.New(401, "invalid_credentials", "账号或密码不正确")
	}
	if !passwd.Verify(password, user.PasswordHash) {
		return nil, apperr.New(401, "invalid_credentials", "账号或密码不正确")
	}
	if user.Status != "active" {
		return nil, apperr.New(403, "user_disabled", "该账号已被停用")
	}
	claims := map[string]any{
		"sub":                user.ID,
		"preferred_username": user.Username,
		"name":               user.DisplayName,
		"role":               user.Role,
		"kind":               user.Kind,
	}
	if user.Email != nil {
		claims["email"] = *user.Email
	}
	return claims, nil
}
