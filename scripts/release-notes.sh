#!/bin/bash

PREV_SHA=$(gh release view latest --json targetCommitish -q '.targetCommitish' 2>/dev/null)

if [ -n "$PREV_SHA" ]; then
    git log "$PREV_SHA"..HEAD --oneline
else
    echo "Initial release"
fi
