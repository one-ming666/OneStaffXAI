#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then cp .env.example .env; fi
if [[ -f package-lock.json ]]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --ignore-scripts; fi
exec npm start
