package main

import (
	"strings"
	"testing"

	"github.com/solana-labs/token-list/automerge/parser"
	"github.com/sourcegraph/go-diff/diff"
)

func newFileDiff(origName, newName string) *diff.FileDiff {
	return &diff.FileDiff{OrigName: origName, NewName: newName}
}

const tokenlistDiff = "b/src/tokens/solana.tokenlist.json"
const newAssetDiff = "b/assets/mainnet/8tGqYibsn9ZYv7513DLyNHUn5pBGKektsg4gKrMPfQrF/logo.png"

func TestParseDiff(t *testing.T) {
	m := &Automerger{}

	tests := []struct {
		name       string
		files      []*diff.FileDiff
		wantErr    string
		wantAssets int
	}{
		{
			name: "valid tokenlist and new asset",
			files: []*diff.FileDiff{
				newFileDiff("/dev/null", newAssetDiff),
				newFileDiff("a/src/tokens/solana.tokenlist.json", tokenlistDiff),
			},
			wantAssets: 1,
		},
		{
			name: "valid tokenlist without any asset",
			files: []*diff.FileDiff{
				newFileDiff("a/src/tokens/solana.tokenlist.json", tokenlistDiff),
			},
			wantAssets: 0,
		},
		{
			name: "ignores CHANGELOG and package.json",
			files: []*diff.FileDiff{
				newFileDiff("a/CHANGELOG.md", "b/CHANGELOG.md"),
				newFileDiff("a/package.json", "b/package.json"),
				newFileDiff("a/src/tokens/solana.tokenlist.json", tokenlistDiff),
			},
			wantAssets: 0,
		},
		{
			name: "modified asset file is rejected",
			files: []*diff.FileDiff{
				newFileDiff("a/assets/mainnet/8tGqYibsn9ZYv7513DLyNHUn5pBGKektsg4gKrMPfQrF/logo.png", newAssetDiff),
				newFileDiff("a/src/tokens/solana.tokenlist.json", tokenlistDiff),
			},
			wantErr: "only new assets are allowed",
		},
		{
			name: "asset path with wrong depth is rejected",
			files: []*diff.FileDiff{
				newFileDiff("/dev/null", "b/assets/mainnet/logo.png"),
				newFileDiff("a/src/tokens/solana.tokenlist.json", tokenlistDiff),
			},
			wantErr: "invalid asset path",
		},
		{
			name: "asset outside mainnet is rejected",
			files: []*diff.FileDiff{
				newFileDiff("/dev/null", "b/assets/testnet/ADDR/logo.png"),
				newFileDiff("a/src/tokens/solana.tokenlist.json", tokenlistDiff),
			},
			wantErr: "invalid asset path",
		},
		{
			name: "unsupported asset extension is rejected",
			files: []*diff.FileDiff{
				newFileDiff("/dev/null", "b/assets/mainnet/ADDR/logo.txt"),
				newFileDiff("a/src/tokens/solana.tokenlist.json", tokenlistDiff),
			},
			wantErr: "invalid asset extension",
		},
		{
			name: "multiple tokenlist diffs are rejected",
			files: []*diff.FileDiff{
				newFileDiff("a/src/tokens/solana.tokenlist.json", tokenlistDiff),
				newFileDiff("a/src/tokens/solana.tokenlist.json", tokenlistDiff),
			},
			wantErr: "found multiple tokenlist diffs",
		},
		{
			name: "unrelated file modification is rejected",
			files: []*diff.FileDiff{
				newFileDiff("a/README.md", "b/README.md"),
				newFileDiff("a/src/tokens/solana.tokenlist.json", tokenlistDiff),
			},
			wantErr: "unsupported file modified",
		},
		{
			name:    "missing tokenlist diff is rejected",
			files:   []*diff.FileDiff{},
			wantErr: "no tokenlist diff found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assets, tlDiff, err := m.parseDiff(tt.files)

			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tt.wantErr)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("expected error containing %q, got %q", tt.wantErr, err.Error())
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(assets) != tt.wantAssets {
				t.Fatalf("expected %d assets, got %d (%v)", tt.wantAssets, len(assets), assets)
			}
			if tlDiff == nil {
				t.Fatalf("expected a tokenlist diff, got nil")
			}
		})
	}
}

func TestIsBlacklistedToken(t *testing.T) {
	m := &Automerger{}

	blacklisted := &parser.Token{Name: "SOLKITTY NFT #123"}
	if err := m.IsBlacklistedToken(blacklisted); err == nil {
		t.Fatalf("expected blacklisted token to be rejected")
	}

	ok := &parser.Token{Name: "A Perfectly Normal Token"}
	if err := m.IsBlacklistedToken(ok); err != nil {
		t.Fatalf("expected token to be allowed, got error: %v", err)
	}
}

func TestIsKnownToken(t *testing.T) {
	m := &Automerger{
		knownAddrs: map[knownEntry]bool{},
		knownNames: map[knownEntry]bool{},
	}
	m.storeKnownToken(&parser.Token{ChainId: 101, Address: "ADDR1", Name: "Existing Token"})

	dupAddr := &parser.Token{ChainId: 101, Address: "ADDR1", Name: "New Name"}
	if err := m.IsKnownToken(dupAddr); err == nil {
		t.Fatalf("expected duplicate address to be rejected")
	}

	dupName := &parser.Token{ChainId: 101, Address: "ADDR2", Name: "existing token"}
	if err := m.IsKnownToken(dupName); err == nil {
		t.Fatalf("expected duplicate name (case-insensitive) to be rejected")
	}

	diffChain := &parser.Token{ChainId: 103, Address: "ADDR1", Name: "Existing Token"}
	if err := m.IsKnownToken(diffChain); err != nil {
		t.Fatalf("expected token on a different chain to be allowed, got error: %v", err)
	}

	newToken := &parser.Token{ChainId: 101, Address: "ADDR3", Name: "Brand New Token"}
	if err := m.IsKnownToken(newToken); err != nil {
		t.Fatalf("expected new token to be allowed, got error: %v", err)
	}
}
