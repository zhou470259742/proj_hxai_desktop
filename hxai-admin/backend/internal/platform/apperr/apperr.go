// Package apperr 定义与 Node 版一致的错误码与 HTTP 状态，文案交给 i18n 渲染。
package apperr

import (
	"errors"
	"net/http"
)

type Error struct {
	Status  int
	Code    string
	Message string // 默认中文；为空时按 Code 走 i18n
	Detail  any
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func New(status int, code, message string, detail ...any) *Error {
	e := &Error{Status: status, Code: code, Message: message}
	if len(detail) > 0 {
		e.Detail = detail[0]
	}
	return e
}

func Bad(message string, detail ...any) *Error {
	return New(http.StatusBadRequest, "bad_request", message, detail...)
}

func Unauthorized(message ...string) *Error {
	msg := "未登录或登录已过期"
	if len(message) > 0 {
		msg = message[0]
	}
	return New(http.StatusUnauthorized, "unauthorized", msg)
}

func Forbidden(message ...string) *Error {
	msg := "没有权限执行该操作"
	if len(message) > 0 {
		msg = message[0]
	}
	return New(http.StatusForbidden, "forbidden", msg)
}

func NotFound(message ...string) *Error {
	msg := "资源不存在"
	if len(message) > 0 {
		msg = message[0]
	}
	return New(http.StatusNotFound, "not_found", msg)
}

func Conflict(message string) *Error {
	return New(http.StatusConflict, "conflict", message)
}

func Internal(cause error) *Error {
	return &Error{Status: http.StatusInternalServerError, Code: "internal_error", Message: "服务器内部错误", Detail: cause}
}

func As(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return Internal(err)
}
