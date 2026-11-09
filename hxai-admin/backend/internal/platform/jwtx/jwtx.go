// Package jwt 使用 github.com/golang-jwt/jwt/v5 签发与 Node 版同构的 HS256 令牌。
// 载荷字段（sub/role/jti/iat/exp）保持一致，迁移期两边签发的令牌可互认。
package jwt

import (
	"errors"
	"time"

	jwtlib "github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	Role string `json:"role"`
	JTI  string `json:"jti"`
	jwtlib.RegisteredClaims
}

type Issuer struct {
	secret []byte
	ttl    time.Duration
}

func NewIssuer(secret string, ttl time.Duration) *Issuer {
	return &Issuer{secret: []byte(secret), ttl: ttl}
}

func (i *Issuer) Issue(userID, role, jti string, now time.Time) (string, time.Time, error) {
	exp := now.Add(i.ttl)
	claims := Claims{
		Role: role,
		JTI:  jti,
		RegisteredClaims: jwtlib.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwtlib.NewNumericDate(now),
			ExpiresAt: jwtlib.NewNumericDate(exp),
		},
	}
	token := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, claims)
	signed, err := token.SignedString(i.secret)
	return signed, exp, err
}

func (i *Issuer) Parse(raw string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwtlib.ParseWithClaims(raw, claims, func(t *jwtlib.Token) (any, error) {
		if t.Method.Alg() != jwtlib.SigningMethodHS256.Alg() {
			return nil, errors.New("unexpected signing method")
		}
		return i.secret, nil
	}, jwtlib.WithValidMethods([]string{jwtlib.SigningMethodHS256.Alg()}), jwtlib.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	if !token.Valid || claims.Subject == "" || claims.JTI == "" {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
