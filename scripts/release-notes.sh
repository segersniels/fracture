#!/bin/bash

PREV_SHA=""

if command -v gh >/dev/null 2>&1; then
    PREV_SHA=$(gh release view latest --json targetCommitish -q '.targetCommitish' 2>/dev/null || true)
fi

if [ -z "$PREV_SHA" ]; then
    PREV_SHA=$(git describe --tags --abbrev=0 2>/dev/null || true)
fi

if [ -n "$PREV_SHA" ]; then
    git log "$PREV_SHA"..HEAD --oneline
else
    git log --oneline
fi
