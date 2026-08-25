package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/go-chi/chi/v5"
	"github.com/raghavendra-talur/household-storage/server/config"
	"github.com/raghavendra-talur/household-storage/server/db"
	"github.com/raghavendra-talur/household-storage/server/events"
	"github.com/raghavendra-talur/household-storage/server/middleware"
	"github.com/raghavendra-talur/household-storage/server/modules/household"
)

//go:embed all:dist/public
var frontendFS embed.FS

// lockFile holds the data-dir lock for the lifetime of the process, so a dev
// instance and the installed service can never share one database.
var lockFile *os.File

func acquireDataDirLock(dataDir string) error {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(dataDir+"/"+config.AppName+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return err
	}
	lockFile = f
	return nil
}

// bindAll binds every host on the exact port — no fallback scanning: the port
// IS the Caddy route, so serving anywhere else would be invisible.
func bindAll(hosts []string, port int) ([]net.Listener, error) {
	var listeners []net.Listener
	for _, host := range hosts {
		ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, port))
		if err != nil {
			for _, prev := range listeners {
				prev.Close()
			}
			return nil, fmt.Errorf("cannot bind %s:%d: %w", host, port, err)
		}
		listeners = append(listeners, ln)
	}
	return listeners, nil
}

func main() {
	portFlag := flag.Int("port", 0, "server listen port (overrides PORT env var)")
	flag.Parse()

	cfg, err := config.Load(*portFlag)
	if err != nil {
		log.Fatal(err)
	}

	if err := acquireDataDirLock(cfg.DataDir); err != nil {
		log.Fatalf("Another instance is already running with DATA_DIR=%s: %v", cfg.DataDir, err)
	}

	conn, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()
	log.Printf("Database: %s", cfg.DBPath)

	r := chi.NewRouter()
	r.Use(middleware.Logging)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	hub := events.NewHub()
	r.Route("/api/v1", func(v1 chi.Router) {
		household.RegisterRoutes(v1, household.NewStore(conn), hub.Notify)
		v1.Get("/events", hub.ServeHTTP)
	})

	if cfg.DevMode {
		viteURL, err := url.Parse(cfg.ViteURL)
		if err != nil {
			log.Fatalf("Invalid VITE_URL: %v", err)
		}
		proxy := httputil.NewSingleHostReverseProxy(viteURL)
		r.NotFound(proxy.ServeHTTP)
		log.Printf("Dev mode: proxying frontend to %s", cfg.ViteURL)
	} else {
		staticFS, err := fs.Sub(frontendFS, "dist/public")
		if err != nil {
			log.Fatal(err)
		}
		fileServer := http.FileServer(http.FS(staticFS))
		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			path := strings.TrimPrefix(r.URL.Path, "/")
			if _, err := fs.Stat(staticFS, path); err != nil {
				// SPA fallback: serve index.html
				indexFile, _ := fs.ReadFile(staticFS, "index.html")
				w.Header().Set("Content-Type", "text/html")
				w.Write(indexFile)
				return
			}
			fileServer.ServeHTTP(w, r)
		})
	}

	listeners, err := bindAll(cfg.Hosts, cfg.Port)
	if err != nil {
		log.Fatal(err)
	}
	for _, ln := range listeners {
		log.Printf("Server listening on %s", ln.Addr())
	}

	server := &http.Server{Handler: r}
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		server.Close()
	}()

	for _, ln := range listeners[1:] {
		go func(l net.Listener) {
			if err := server.Serve(l); err != http.ErrServerClosed {
				log.Fatal(err)
			}
		}(ln)
	}
	if err := server.Serve(listeners[0]); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
