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
	$(eval PREV_SHA := $(shell gh release view latest --json targetCommitish -q '.targetCommitish' 2>/dev/null))
	-gh release delete latest --yes 2>/dev/null
	gh release create latest --target "$$(git rev-parse HEAD)" --title "Latest" \
		--notes "$$(if [ -n '$(PREV_SHA)' ]; then git log $(PREV_SHA)..HEAD --oneline; else echo 'Initial release'; fi)" \
		$(RELEASE_BINARIES)
	rm -f $(RELEASE_BINARIES)
