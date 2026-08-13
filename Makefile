# Build the cockpit-cotbridge plugin bundle and packages.
#
# make          — build dist/ (fetches pkg/lib and node_modules on first run)
# make check    — eslint + stylelint + tsc + vitest
# make package  — deb + rpm via nfpm (requires VERSION or a git tag)

PACKAGE_NAME := cotbridge
VERSION ?= $(shell T=$$(git describe --tags 2>/dev/null | sed 's/^v//'); \
	if [ -z "$$T" ]; then T=0; fi; echo "$$T" | tr '-' '.')

NODE_MODULES_STAMP = node_modules/.npm-stamp
COCKPIT_REPO_STAMP = pkg/lib/cockpit-po-plugin.js
DIST_TEST = dist/manifest.json

# Checkout common files from the Cockpit repository required to build this
# project; no API stability guarantee — pin a commit and update deliberately.
COCKPIT_REPO_FILES = pkg/lib
COCKPIT_REPO_URL = https://github.com/cockpit-project/cockpit.git
COCKPIT_REPO_COMMIT = 7776f5476411577da93a0fc8ba9ba467d846358f

all: $(DIST_TEST)

$(COCKPIT_REPO_STAMP): Makefile
	@git rev-list --quiet --objects '$(COCKPIT_REPO_COMMIT)^{tree}' -- 2>/dev/null || \
	    git fetch --no-tags --no-write-fetch-head --depth=1 $(COCKPIT_REPO_URL) $(COCKPIT_REPO_COMMIT)
	git archive '$(COCKPIT_REPO_COMMIT)^{tree}' -- $(COCKPIT_REPO_FILES) | tar x

$(NODE_MODULES_STAMP): package.json package-lock.json
	npm ci
	touch $@

$(DIST_TEST): $(COCKPIT_REPO_STAMP) $(NODE_MODULES_STAMP) build.js $(wildcard src/*)
	NODE_ENV=production ./build.js

.PHONY: check
check: $(COCKPIT_REPO_STAMP) $(NODE_MODULES_STAMP)
	npx eslint src/
	npx stylelint 'src/*.scss'
	npx tsc --noEmit
	npx vitest run

.PHONY: watch
watch: $(COCKPIT_REPO_STAMP) $(NODE_MODULES_STAMP)
	ESBUILD_WATCH=true ./build.js

# Install the built bundle for a local Cockpit (development convenience).
.PHONY: devinstall
devinstall: $(DIST_TEST)
	mkdir -p ~/.local/share/cockpit
	ln -sfn "$(CURDIR)/dist" ~/.local/share/cockpit/$(PACKAGE_NAME)

.PHONY: package
package: $(DIST_TEST)
	mkdir -p out
	VERSION=$(VERSION) nfpm package -f nfpm.yaml -p deb -t out/
	VERSION=$(VERSION) nfpm package -f nfpm.yaml -p rpm -t out/

.PHONY: clean
clean:
	rm -rf dist out

.PHONY: distclean
distclean: clean
	rm -rf node_modules pkg
