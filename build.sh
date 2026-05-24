#!/bin/bash
set -e

# Build landing page
echo "Building landing page..."
cd landing
npm install
npm run build
cd ..

# Build React app (outputs to dist/ with base /app/)
echo "Building React app..."
npm install
npm run build

# Merge into publish/
echo "Merging outputs..."
rm -rf publish
mkdir -p publish

# Landing page at root
cp -r landing/dist/. publish/

# React app under /app
mkdir -p publish/app
cp -r dist/. publish/app/

# Redirect /join/CODE → /app/?join=CODE for share links
echo "/join/* /app/?join=:splat 302" > publish/_redirects

echo "Done. publish/ is ready."
