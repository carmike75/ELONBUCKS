package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"

	"github.com/dgrijalva/jwt-go"
)

func generateTestPEM(t *testing.T) []byte {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})
}

func TestSignJWTFromPEM(t *testing.T) {
	keyPEM := generateTestPEM(t)

	const appId = int64(12345)
	tokenString, err := signJWTFromPEM(keyPEM, appId)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	block, _ := pem.Decode(keyPEM)
	privateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("failed to parse generated key: %v", err)
	}

	parsed, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return &privateKey.PublicKey, nil
	})
	if err != nil {
		t.Fatalf("failed to parse/verify signed token: %v", err)
	}

	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		t.Fatalf("expected MapClaims, got %T", parsed.Claims)
	}
	if claims["iss"] != "12345" {
		t.Fatalf("expected iss claim 12345, got %v", claims["iss"])
	}
	if _, ok := claims["exp"]; !ok {
		t.Fatalf("expected exp claim to be set")
	}
	if _, ok := claims["iat"]; !ok {
		t.Fatalf("expected iat claim to be set")
	}
}

func TestSignJWTFromPEM_InvalidPEM(t *testing.T) {
	_, err := signJWTFromPEM([]byte("not a valid PEM block"), 1)
	if err != ErrInvalidKey {
		t.Fatalf("expected ErrInvalidKey, got %v", err)
	}
}

func TestSignJWTFromPEM_InvalidKeyBytes(t *testing.T) {
	badBlock := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: []byte("not a real key"),
	})
	if _, err := signJWTFromPEM(badBlock, 1); err == nil {
		t.Fatalf("expected an error for malformed key bytes")
	}
}
