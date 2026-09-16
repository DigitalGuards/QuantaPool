package main

import "testing"

func TestLoopbackTargetBoundary(t *testing.T) {
	for _, value := range []string{"http://127.0.0.1:3500", "http://[::1]:3500"} {
		if _, err := loopbackURL(value); err != nil {
			t.Fatalf("valid local origin rejected: %v", err)
		}
	}
	for _, value := range []string{"https://127.0.0.1:3500", "http://localhost:3500", "http://203.0.113.4:3500", "http://127.0.0.1.example:3500", "http://user@127.0.0.1:3500", "http://127.0.0.1:3500/rpc", "http://127.0.0.1:3500?target=other", "http://127.0.0.1:3500#fragment"} {
		if _, err := loopbackURL(value); err == nil {
			t.Fatalf("unsafe origin accepted: %q", value)
		}
	}
}

func TestExplicitFixtureIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, expectedTime, expectedChain, actualTime, actualChain string
		valid                                                      bool
	}{
		{"matching fixture", "1789394127", "3151915", "1789394127", "3151915", true},
		{"legacy root-only mode remains explicit", "", "", "1789394127", "3151915", true},
		{"same validator root but different time", "1789394127", "3151915", "1789390677", "3151915", false},
		{"same validator root but different chain", "1789394127", "3151915", "1789394127", "3151914", false},
		{"missing paired chain pin", "1789394127", "", "1789394127", "3151915", false},
		{"noncanonical chain pin", "1789394127", "03151915", "1789394127", "3151915", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := checkFixtureIdentity(tc.expectedTime, tc.expectedChain, tc.actualTime, tc.actualChain); (err == nil) != tc.valid {
				t.Fatalf("unexpected fixture identity result: %v", err)
			}
		})
	}
}
