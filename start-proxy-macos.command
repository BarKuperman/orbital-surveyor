#!/bin/sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js was not found.'
  printf '%s\n' 'Install Node.js from https://nodejs.org/ and run this file again.'
  printf '\nPress Enter to close...'
  read -r _
  exit 1
fi

node proxy.js
printf '\nProxy stopped. Press Enter to close...'
read -r _
