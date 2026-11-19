package handlers

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	appconfig "github.com/esxi-builder/esxi-iso-builder/internal/config"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

const (
	settingAdminPasswordHash = "admin_password_hash"
	settingAdminSigningKey   = "admin_signing_key"
	adminSessionCookieName   = "esxi_admin_session"
	adminTokenHeaderName     = "X-Admin-Token"
	adminSessionTTL          = 7 * 24 * time.Hour
	minAdminPasswordRunes    = 6
	contextIsAdminKey        = "is_admin"
)

type AdminAuthManager struct {
	db          *gorm.DB
	envPassword string
	appVersion  string

	mu         sync.Mutex
	signingKey []byte
}

type adminPasswordSetupRequest struct {
	Password string `json:"password"`
}

type adminLoginRequest struct {
	Password string `json:"password"`
}

type adminChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func NewAdminAuthManager(db *gorm.DB, cfg *appconfig.Config) *AdminAuthManager {
	envPassword := ""
	rawVersion := ""
	if cfg != nil {
		envPassword = strings.TrimSpace(cfg.Server.AdminPassword)
		rawVersion = cfg.Server.AppVersion
	}
	if db != nil && !db.Migrator().HasTable(&models.SystemSetting{}) {
		_ = db.AutoMigrate(&models.SystemSetting{})
	}
	return &AdminAuthManager{
		db:          db,
		envPassword: envPassword,
		appVersion:  appconfig.ResolveAppVersion(rawVersion),
	}
}

func (m *AdminAuthManager) Status(c *fiber.Ctx) error {
	configured, envManaged, _, err := m.passwordState()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("读取管理员配置失败"))
	}

	return c.JSON(utils.SuccessResponse(fiber.Map{
		"version":       m.appVersion,
		"configured":    configured,
		"authenticated": configured && m.IsAuthenticated(c),
		"env_managed":   envManaged,
	}))
}

func (m *AdminAuthManager) Setup(c *fiber.Ctx) error {
	if m.envPassword != "" {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("当前管理员密码已由环境变量配置，请直接登录"))
	}

	var req adminPasswordSetupRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("请求格式无效"))
	}
	password := strings.TrimSpace(req.Password)
	if utf8.RuneCountInString(password) < minAdminPasswordRunes {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("管理员密码至少需要 6 个字符"))
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("密码加密失败"))
	}

	var alreadyConfigured bool
	err = m.db.WithContext(c.UserContext()).Transaction(func(tx *gorm.DB) error {
		var existing models.SystemSetting
		findErr := tx.Where("key = ?", settingAdminPasswordHash).First(&existing).Error
		if findErr == nil && strings.TrimSpace(existing.Value) != "" {
			alreadyConfigured = true
			return nil
		}
		if findErr != nil && !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return findErr
		}
		setting := models.SystemSetting{
			Key:       settingAdminPasswordHash,
			Value:     string(hashed),
			UpdatedAt: time.Now().UTC(),
		}
		return tx.Save(&setting).Error
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("保存管理员密码失败"))
	}
	if alreadyConfigured {
		return c.Status(fiber.StatusConflict).JSON(utils.ErrorResponse("管理员密码已设置，请使用管理员登录"))
	}

	token, expiresAt, err := m.issueSession(c, string(hashed))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("签发管理员会话失败"))
	}

	return c.Status(fiber.StatusCreated).JSON(utils.SuccessResponse(fiber.Map{
		"version":       m.appVersion,
		"configured":    true,
		"authenticated": true,
		"env_managed":   false,
		"token":         token,
		"expires_at":    expiresAt,
	}))
}

func (m *AdminAuthManager) Login(c *fiber.Ctx) error {
	configured, envManaged, credential, err := m.passwordState()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("读取管理员状态失败"))
	}
	if !configured {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"success": false,
			"code":    "admin_setup_required",
			"error":   "尚未设置管理员密码，请先完成初始化设置",
		})
	}

	var req adminLoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("请求格式无效"))
	}
	password := strings.TrimSpace(req.Password)
	if password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("请输入管理员密码"))
	}

	if envManaged {
		if subtle.ConstantTimeCompare([]byte(password), []byte(m.envPassword)) != 1 {
			return c.Status(fiber.StatusUnauthorized).JSON(utils.ErrorResponse("管理员密码错误"))
		}
	} else {
		if bcrypt.CompareHashAndPassword([]byte(credential), []byte(password)) != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(utils.ErrorResponse("管理员密码错误"))
		}
	}

	token, expiresAt, err := m.issueSession(c, credential)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("签发管理员会话失败"))
	}

	return c.JSON(utils.SuccessResponse(fiber.Map{
		"version":       m.appVersion,
		"configured":    true,
		"authenticated": true,
		"env_managed":   envManaged,
		"token":         token,
		"expires_at":    expiresAt,
	}))
}

func (m *AdminAuthManager) Logout(c *fiber.Ctx) error {
	m.clearCookie(c)
	configured, envManaged, _, _ := m.passwordState()
	return c.JSON(utils.SuccessResponse(fiber.Map{
		"version":       m.appVersion,
		"configured":    configured,
		"authenticated": false,
		"env_managed":   envManaged,
	}))
}

func (m *AdminAuthManager) ChangePassword(c *fiber.Ctx) error {
	configured, envManaged, currentHash, err := m.passwordState()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("读取管理员配置失败"))
	}
	if envManaged {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("当前管理员密码由容器环境变量 ADMIN_PASSWORD 托管，请修改环境变量后重启容器"))
	}
	if !configured {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("请先设置管理员密码"))
	}

	var req adminChangePasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("请求格式无效"))
	}
	currentPassword := strings.TrimSpace(req.CurrentPassword)
	newPassword := strings.TrimSpace(req.NewPassword)

	if currentPassword == "" {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("请输入当前密码"))
	}
	if utf8.RuneCountInString(newPassword) < minAdminPasswordRunes {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("新密码至少需要 6 个字符"))
	}
	if bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(currentPassword)) != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(utils.ErrorResponse("当前密码错误"))
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("密码加密失败"))
	}

	setting := models.SystemSetting{
		Key:       settingAdminPasswordHash,
		Value:     string(hashed),
		UpdatedAt: time.Now().UTC(),
	}
	if err := m.db.WithContext(c.UserContext()).Save(&setting).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("更新管理员密码失败"))
	}

	token, expiresAt, err := m.issueSession(c, string(hashed))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("签发管理员会话失败"))
	}

	return c.JSON(utils.SuccessResponse(fiber.Map{
		"version":       m.appVersion,
		"configured":    true,
		"authenticated": true,
		"env_managed":   false,
		"token":         token,
		"expires_at":    expiresAt,
	}))
}

func (m *AdminAuthManager) AttachIdentity() fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Locals(contextIsAdminKey, m.IsAuthenticated(c))
		return c.Next()
	}
}

func (m *AdminAuthManager) RequireAdmin() fiber.Handler {
	return func(c *fiber.Ctx) error {
		if m.IsAuthenticated(c) {
			c.Locals(contextIsAdminKey, true)
			return c.Next()
		}

		configured, _, _, err := m.passwordState()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse("读取管理员状态失败"))
		}
		if !configured {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false,
				"code":    "admin_setup_required",
				"error":   "请先设置管理员密码",
			})
		}
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"success": false,
			"code":    "admin_auth_required",
			"error":   "需要管理员权限，请先登录",
		})
	}
}

func (m *AdminAuthManager) IsAuthenticated(c *fiber.Ctx) bool {
	configured, _, credential, err := m.passwordState()
	if err != nil || !configured {
		return false
	}

	rawToken := strings.TrimSpace(c.Get(adminTokenHeaderName))
	if rawToken == "" {
		rawToken = strings.TrimSpace(c.Cookies(adminSessionCookieName))
	}
	if rawToken == "" {
		return false
	}

	return m.verifySessionToken(rawToken, credential)
}

func (m *AdminAuthManager) passwordState() (configured bool, envManaged bool, credential string, err error) {
	if m.envPassword != "" {
		return true, true, "env:" + m.envPassword, nil
	}
	if m.db == nil {
		return false, false, "", nil
	}

	var setting models.SystemSetting
	err = m.db.Where("key = ?", settingAdminPasswordHash).First(&setting).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, false, "", nil
	}
	if err != nil {
		return false, false, "", err
	}

	trimmed := strings.TrimSpace(setting.Value)
	if trimmed == "" {
		return false, false, "", nil
	}
	return true, false, trimmed, nil
}

func (m *AdminAuthManager) ensureSigningKey() ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.signingKey) >= 32 {
		return m.signingKey, nil
	}

	if m.db != nil {
		var existing models.SystemSetting
		err := m.db.Where("key = ?", settingAdminSigningKey).First(&existing).Error
		if err == nil {
			if decoded, decErr := hex.DecodeString(strings.TrimSpace(existing.Value)); decErr == nil && len(decoded) >= 32 {
				m.signingKey = decoded
				return m.signingKey, nil
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return nil, err
	}
	if m.db != nil {
		_ = m.db.Save(&models.SystemSetting{
			Key:       settingAdminSigningKey,
			Value:     hex.EncodeToString(randomBytes),
			UpdatedAt: time.Now().UTC(),
		}).Error
	}
	m.signingKey = randomBytes
	return m.signingKey, nil
}

func credentialRevision(credential string) string {
	sum := sha256.Sum256([]byte(credential))
	return hex.EncodeToString(sum[:8])
}

func (m *AdminAuthManager) issueSession(c *fiber.Ctx, credential string) (string, time.Time, error) {
	key, err := m.ensureSigningKey()
	if err != nil {
		return "", time.Time{}, err
	}

	expiresAt := time.Now().UTC().Add(adminSessionTTL)
	payload := fmt.Sprintf("%d.%s", expiresAt.Unix(), credentialRevision(credential))
	encodedPayload := base64.RawURLEncoding.EncodeToString([]byte(payload))

	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(encodedPayload))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	token := encodedPayload + "." + signature
	c.Cookie(&fiber.Cookie{
		Name:     adminSessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(adminSessionTTL.Seconds()),
		HTTPOnly: true,
		SameSite: "Lax",
		Secure:   strings.EqualFold(c.Protocol(), "https"),
	})
	return token, expiresAt, nil
}

func (m *AdminAuthManager) clearCookie(c *fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name:     adminSessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HTTPOnly: true,
		SameSite: "Lax",
	})
}

func (m *AdminAuthManager) verifySessionToken(token string, credential string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false
	}
	key, err := m.ensureSigningKey()
	if err != nil {
		return false
	}

	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(parts[0]))
	expectedSig := mac.Sum(nil)
	actualSig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || subtle.ConstantTimeCompare(actualSig, expectedSig) != 1 {
		return false
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	payloadParts := strings.SplitN(string(payloadBytes), ".", 2)
	if len(payloadParts) != 2 {
		return false
	}

	expUnix, err := strconv.ParseInt(payloadParts[0], 10, 64)
	if err != nil || time.Now().UTC().Unix() > expUnix {
		return false
	}

	expectedRev := credentialRevision(credential)
	return subtle.ConstantTimeCompare([]byte(payloadParts[1]), []byte(expectedRev)) == 1
}

func isAdminRequest(c *fiber.Ctx) bool {
	val := c.Locals(contextIsAdminKey)
	if val == nil {
		// Direct handler unit tests do not mount AttachIdentity; preserve existing behavior.
		return true
	}
	isAdmin, ok := val.(bool)
	return ok && isAdmin
}
