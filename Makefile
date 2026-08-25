TOOLS_MOD := tools.mod
GO_TOOL := go tool -modfile=$(TOOLS_MOD)

.PHONY: dev build test lint install clean

dev:
	tmux-dev run homestead sh -c '$(GO_TOOL) mage dev'

build:
	$(GO_TOOL) mage build

test:
	go test ./...
	npm test

lint:
	go vet ./...
	npm run check

install:
	$(GO_TOOL) mage install

clean:
	$(GO_TOOL) mage clean
