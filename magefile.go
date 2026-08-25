//go:build mage

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/magefile/mage/mg"
	"github.com/magefile/mage/sh"
)

const appName = "homestead" // subdomain, tmux session suffix, launchd suffix

var (
	home     = os.Getenv("HOME")
	label    = "net.rtalur." + appName
	prefix   = filepath.Join(home, "Library", "Application Support", appName)
	logDir   = filepath.Join(home, "Library", "Logs", appName)
	plistDst = filepath.Join(home, "Library", "LaunchAgents", label+".plist")
)

// ensurePort resolves the project's port from the route manager. Existing
// routes resolve read-only; allocation falls back to sudo -n (NOPASSWD).
func ensurePort() (string, error) {
	cli := filepath.Join(home, "Library", "Application Support", "homepage", "homepage-cli")
	out, err := exec.Command(cli, "ensure", appName).Output()
	if err != nil {
		out, err = exec.Command("sudo", "-n", cli, "ensure", appName).Output()
		if err != nil {
			return "", fmt.Errorf("homepage-cli ensure %s: %w", appName, err)
		}
	}
	port := strings.TrimSpace(string(out))
	if _, err := strconv.Atoi(port); err != nil {
		return "", fmt.Errorf("unexpected ensure output %q", port)
	}
	return port, nil
}

// Dev: Go on $PORT via air, vite on the derived internal port. tmux-dev
// exports PORT into the session; never default it to a literal.
func Dev() error {
	port := os.Getenv("PORT")
	if port == "" {
		return fmt.Errorf("PORT not set — run via `make dev` (tmux-dev), not directly")
	}
	n, err := strconv.Atoi(port)
	if err != nil {
		return fmt.Errorf("invalid PORT %q", port)
	}
	vitePort := strconv.Itoa(n + 1000)

	vite := exec.Command("npx", "vite")
	vite.Env = append(os.Environ(), "VITE_PORT="+vitePort)
	vite.Stdout, vite.Stderr = os.Stdout, os.Stderr

	air := exec.Command("go", "tool", "-modfile=tools.mod", "air")
	air.Env = append(os.Environ(), "DEV=1", "VITE_URL=http://127.0.0.1:"+vitePort)
	air.Stdout, air.Stderr = os.Stdout, os.Stderr

	if err := vite.Start(); err != nil {
		return err
	}
	if err := air.Start(); err != nil {
		_ = vite.Process.Kill()
		return err
	}
	done := make(chan error, 2)
	go func() { done <- air.Wait() }()
	go func() { done <- vite.Wait() }()
	err = <-done
	_ = air.Process.Signal(os.Interrupt)
	_ = vite.Process.Signal(os.Interrupt)
	<-done
	return err
}

// Build: vite build → server/dist/public → single embedded binary in bin/.
func Build() error {
	if err := sh.RunV("npm", "run", "build"); err != nil {
		return err
	}
	return sh.RunV("go", "build", "-o", filepath.Join("bin", appName), "./server")
}

// Install: build, place the binary, render the plist with the ensured port,
// bootstrap the launchd agent. Dev shares the port: `tmux-dev stop homestead` first.
func Install() error {
	mg.Deps(Build)
	port, err := ensurePort()
	if err != nil {
		return err
	}
	for _, d := range []string{prefix, logDir, filepath.Dir(plistDst)} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
	}
	if err := sh.Copy(filepath.Join(prefix, appName), filepath.Join("bin", appName)); err != nil {
		return err
	}
	tmpl, err := os.ReadFile(filepath.Join("service", "launchd.plist.in"))
	if err != nil {
		return err
	}
	rendered := strings.NewReplacer(
		"@@NAME@@", appName,
		"@@BINARY@@", filepath.Join(prefix, appName),
		"@@PORT@@", port,
		"@@WORKDIR@@", prefix,
		"@@LOGDIR@@", logDir,
	).Replace(string(tmpl))
	if err := os.WriteFile(plistDst, []byte(rendered), 0o644); err != nil {
		return err
	}
	uid := fmt.Sprint(os.Getuid())
	_ = sh.Run("launchctl", "bootout", "gui/"+uid+"/"+label)
	if err := sh.RunV("launchctl", "bootstrap", "gui/"+uid, plistDst); err != nil {
		return err
	}
	fmt.Println("installed: https://" + appName + ".rtalur.net")
	return nil
}

func Clean() error {
	for _, d := range []string{"bin", "tmp"} {
		if err := os.RemoveAll(d); err != nil {
			return err
		}
	}
	if err := os.RemoveAll(filepath.Join("server", "dist", "public")); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join("server", "dist", "public"), 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join("server", "dist", "public", ".gitkeep"), nil, 0o644)
}
