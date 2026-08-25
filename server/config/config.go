package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// AppName drives the default data directory (~/.local/share/homestead) and
// the database filename. It matches the subdomain, not the repo directory.
const AppName = "homestead"

type Config struct {
	DBPath  string   // SQLite database file path
	Port    int      // required: from $PORT or --port; never defaulted
	Hosts   []string // bind addresses (default: ["127.0.0.1"])
	DataDir string   // local filesystem storage
	DevMode bool     // DEV=1: proxy non-API routes to Vite
	ViteURL string   // Vite dev server URL for proxying in dev mode
}

// expandHome replaces a leading ~ with the user's home directory.
func expandHome(path string) string {
	if path == "~" || path == "~/" {
		home, _ := os.UserHomeDir()
		return home
	}
	if strings.HasPrefix(path, "~/") {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, path[2:])
	}
	return path
}

// Load builds the config from the environment. portFlag overrides $PORT when
// non-zero. The port has no default: it is allocated by `homepage-cli ensure`
// and delivered via tmux-dev (dev) or the launchd plist (prod).
func Load(portFlag int) (*Config, error) {
	port := portFlag
	if port == 0 {
		p := os.Getenv("PORT")
		if p == "" {
			return nil, fmt.Errorf("PORT not set — run via `make dev` (tmux-dev) or the launchd service")
		}
		v, err := strconv.Atoi(p)
		if err != nil {
			return nil, fmt.Errorf("invalid PORT %q", p)
		}
		port = v
	}

	dataDir := expandHome(os.Getenv("DATA_DIR"))
	if dataDir == "" {
		xdgData := os.Getenv("XDG_DATA_HOME")
		if xdgData == "" {
			home, _ := os.UserHomeDir()
			xdgData = filepath.Join(home, ".local", "share")
		}
		dataDir = filepath.Join(xdgData, AppName)
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = filepath.Join(dataDir, AppName+".db")
	}

	hosts := []string{"127.0.0.1"}
	if h := os.Getenv("HOST"); h != "" {
		hosts = nil
		for _, addr := range strings.Split(h, ",") {
			addr = strings.TrimSpace(addr)
			if addr != "" {
				hosts = append(hosts, addr)
			}
		}
	}

	devMode := os.Getenv("DEV") == "1"
	viteURL := os.Getenv("VITE_URL")
	if devMode && viteURL == "" {
		return nil, fmt.Errorf("DEV=1 requires VITE_URL (set by `mage dev`)")
	}

	return &Config{
		DBPath:  dbPath,
		Port:    port,
		Hosts:   hosts,
		DataDir: dataDir,
		DevMode: devMode,
		ViteURL: viteURL,
	}, nil
}
