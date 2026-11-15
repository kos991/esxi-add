package scripts

import (
 "os"
 "os/exec"
 "path/filepath"
 "strings"
 "testing"
)

// bashCompatibleShell skips launchers (e.g. the WSL stub) that cannot run the script.
func bashCompatibleShell(t *testing.T) string {
 t.Helper()
 for _, name := range []string{"bash", "sh"} {
  shell, err := exec.LookPath(name)
  if err != nil { continue }
  probe, err := exec.Command(shell, "-c", "[[ 1 == 1 ]] && echo compatible").Output()
  if err == nil && strings.Contains(string(probe), "compatible") { return shell }
 }
 t.Skip("no bash-compatible shell available")
 return ""
}

func runNativeScript(t *testing.T, args ...string) (string, error) {
 t.Helper()
 cmd := exec.Command(bashCompatibleShell(t), append([]string{filepath.Join(".", "build-native-iso.sh")}, args...)...)
 out, err := cmd.CombinedOutput()
 return string(out), err
}

func TestNativeBuildRejectsDepotZipAndNeverReplacesSource(t *testing.T) {
 dir := t.TempDir()
 source := filepath.Join(dir, "ESXi-depot.zip")
 if err := os.WriteFile(source, []byte("PK\x03\x04not-an-iso"), 0600); err != nil { t.Fatal(err) }
 // A decoy ISO in the same tree must never be substituted for the supplied input.
 decoy := filepath.Join(dir, "..", "output", "old-"+filepath.Base(dir)+".iso")
 if err := os.MkdirAll(filepath.Dir(decoy), 0700); err != nil { t.Fatal(err) }
 if err := os.WriteFile(decoy, []byte("CD001decoy"), 0600); err != nil { t.Fatal(err) }
 defer os.Remove(decoy)
 output := filepath.Join(dir, "result.iso")
 text, err := runNativeScript(t, "--depot-path", source, "--output-path", output, "--esxi-version", "8.0", "--work-dir", filepath.Join(dir, "work"))
 if err == nil { t.Fatalf("ZIP source accepted: %s", text) }
 if !strings.Contains(text, "PowerCLI") || !strings.Contains(text, "ZIP") { t.Fatalf("unclear rejection: %s", text) }
 if _, statErr := os.Stat(output); statErr == nil { t.Fatal("produced output from ZIP source") }
 if _, statErr := os.Stat(decoy); statErr != nil { t.Fatal("decoy ISO was moved or replaced") }
}

func TestNativeBuildRejectsInvalidIsoAndExistingOutput(t *testing.T) {
 dir := t.TempDir()
 fakeISO := filepath.Join(dir, "fake.iso")
 if err := os.WriteFile(fakeISO, []byte("not iso9660"), 0600); err != nil { t.Fatal(err) }
 if text, err := runNativeScript(t, "--depot-path", fakeISO, "--output-path", filepath.Join(dir, "out.iso"), "--work-dir", filepath.Join(dir, "w")); err == nil || !strings.Contains(text, "ISO9660") { t.Fatalf("invalid ISO accepted: %s", text) }

 valid := filepath.Join(dir, "valid.iso")
 payload := make([]byte, 40000)
 copy(payload[32769:], "CD001")
 if err := os.WriteFile(valid, payload, 0600); err != nil { t.Fatal(err) }
 existingOutput := filepath.Join(dir, "existing.iso")
 if err := os.WriteFile(existingOutput, []byte("old-artifact"), 0600); err != nil { t.Fatal(err) }
 text, err := runNativeScript(t, "--depot-path", valid, "--output-path", existingOutput, "--work-dir", filepath.Join(dir, "w2"))
 if err == nil || !strings.Contains(text, "已存在") { t.Fatalf("existing output overwritten: %s", text) }
 if data, _ := os.ReadFile(existingOutput); string(data) != "old-artifact" { t.Fatal("existing artifact modified") }
}
