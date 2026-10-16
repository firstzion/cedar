#!/bin/sh
# usage: fetch-ref.sh <repo-url> <sha-or-tag> <dest-dir>
set -e
mkdir -p "$3" && cd "$3"
git init -q
git remote add origin "$1"
git fetch -q --depth 1 origin "$2"
git checkout -q FETCH_HEAD
rm -rf .git
