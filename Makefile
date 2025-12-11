BINARY_NAME=fracture
INSTALL_PATH=/usr/local/bin
VERSION ?= $(shell date +%Y%m%d%H%M%S)

.PHONY: build install uninstall clean publish

build:
	bun build src/index.ts --compile --outfile $(BINARY_NAME)

build-release:
	bun build src/index.ts --compile --target=bun-darwin-arm64 --outfile $(BINARY_NAME)-darwin-arm64

install: build
	sudo mv $(BINARY_NAME) $(INSTALL_PATH)/$(BINARY_NAME)

uninstall:
	sudo rm -f $(INSTALL_PATH)/$(BINARY_NAME)

clean:
	rm -f $(BINARY_NAME) $(BINARY_NAME)-darwin-arm64

publish: build-release
	@if ! gh release view latest >/dev/null 2>&1; then \
		gh release create latest --title "Latest" --notes "Latest release"; \
	fi
	gh release upload latest $(BINARY_NAME)-darwin-arm64 --clobber
	rm -f $(BINARY_NAME)-darwin-arm64
