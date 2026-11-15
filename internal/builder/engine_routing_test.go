package builder

import (
	"path/filepath"
	"testing"
)

func TestEngineRoutesByActualInput(t *testing.T) {
	for _, configured := range []string{"build-native-iso.sh", "build-esxi-iso.ps1"} {
		e := NewPowerShellExecutor("pwsh", filepath.Join("scripts", configured))
		for _, tc := range []struct{ source, engine, script string }{{"selected.ISO", "native", "build-native-iso.sh"}, {"selected.ZIP", "powercli", "build-esxi-iso.ps1"}} {
			script, engine, err := e.SelectEngine(tc.source)
			if err != nil || engine != tc.engine || filepath.Base(script) != tc.script {
				t.Fatalf("%s/%s: %s %s %v", configured, tc.source, script, engine, err)
			}
		}
		if _, _, err := e.SelectEngine("driver.vib"); err == nil {
			t.Fatal("driver accepted as source")
		}
	}
}
