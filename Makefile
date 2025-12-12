BINARY_NAME=fracture
INSTALL_PATH=~/.local/bin
VERSION ?= $(shell date +%Y%m%d%H%M%S)

PLATFORMS = darwin-arm64 linux-arm64 linux-x64
RELEASE_BINARIES = $(addprefix $(BINARY_NAME)-,$(PLATFORMS))

.PHONY: build build-release install uninstall clean publish

build:
	bun build src/index.ts --compile --outfile $(BINARY_NAME)

$(BINARY_NAME)-%: src/index.ts
	bun build $< --compile --target=bun-$* --outfile $@

build-release: $(RELEASE_BINARIES)

install: build
	mv $(BINARY_NAME) $(INSTALL_PATH)/$(BINARY_NAME)

uninstall:
	rm -f $(INSTALL_PATH)/$(BINARY_NAME)

clean:
	rm -f $(BINARY_NAME) $(RELEASE_BINARIES)

publish: build-release
	@if ! gh release view latest >/dev/null 2>&1; then \
		gh release create latest --title "Latest" --notes "Latest release"; \
	fi
	gh release upload latest $(RELEASE_BINARIES) --clobber
	rm -f $(RELEASE_BINARIES)
