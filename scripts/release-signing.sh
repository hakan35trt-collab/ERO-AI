#!/usr/bin/env bash
# Prepares the release keystore for Gradle.
# Prefers ERO_KEYSTORE_* secrets. Otherwise reuses the encrypted bundle on the
# signing-key release, or creates that bundle on the first run.
# Passwords and passphrases are masked and never echoed.
set -euo pipefail
umask 077

mask() {
  if [ -n "${1:-}" ]; then
    printf '::add-mask::%s\n' "$1"
  fi
}

derive_pass() {
  if [ -n "${ERO_SIGNING_PASSPHRASE:-}" ]; then
    printf '%s' "$ERO_SIGNING_PASSPHRASE"
    return
  fi
  if [ -z "${GEMINI_API_KEY:-}" ]; then
    echo "No ERO_SIGNING_PASSPHRASE and GEMINI_API_KEY is empty. The signing bundle stays locked." >&2
    exit 1
  fi
  printf '%s' "$GEMINI_API_KEY" | openssl dgst -sha256 -hmac "ero-signing-salt-v1" -binary | base64 -w 0
}

encrypt_file() {
  local input="$1" output="$2" pass
  pass="$(derive_pass)"
  mask "$pass"
  ENC_PASS="$pass" openssl enc -aes-256-cbc -pbkdf2 -iter 210000 -md sha256 -salt \
    -pass env:ENC_PASS -in "$input" -out "$output"
  unset ENC_PASS
}

decrypt_file() {
  local input="$1" output="$2" pass status
  pass="$(derive_pass)"
  mask "$pass"
  set +e
  ENC_PASS="$pass" openssl enc -d -aes-256-cbc -pbkdf2 -iter 210000 -md sha256 \
    -pass env:ENC_PASS -in "$input" -out "$output"
  status=$?
  set -e
  unset ENC_PASS
  return "$status"
}

read_passfile() {
  local file="$1" line key value
  ERO_KEY_ALIAS=""
  ERO_KEYSTORE_PASSWORD=""
  ERO_KEY_PASSWORD=""
  while IFS= read -r line || [ -n "$line" ]; do
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      alias) ERO_KEY_ALIAS="$value" ;;
      store) ERO_KEYSTORE_PASSWORD="$value" ;;
      key) ERO_KEY_PASSWORD="$value" ;;
    esac
  done < "$file"
  if [ -z "$ERO_KEY_ALIAS" ] || [ -z "$ERO_KEYSTORE_PASSWORD" ] || [ -z "$ERO_KEY_PASSWORD" ]; then
    echo "The signing bundle is missing its password file." >&2
    exit 1
  fi
  mask "$ERO_KEY_ALIAS"
  mask "$ERO_KEYSTORE_PASSWORD"
  mask "$ERO_KEY_PASSWORD"
}

cert_sha() {
  local ks="$1"
  keytool -list -v -keystore "$ks" -storepass "$ERO_KEYSTORE_PASSWORD" -alias "$ERO_KEY_ALIAS" \
    | awk '/SHA256:/{print $2; exit}'
}

publish_env() {
  local ks="$1" fp
  fp="$(cert_sha "$ks")"
  if [ -z "$fp" ]; then
    echo "The keystore did not yield a certificate fingerprint." >&2
    exit 1
  fi
  echo "Certificate SHA256: $fp"
  if [ -n "${GITHUB_ENV:-}" ]; then
    {
      echo "ERO_KEYSTORE_FILE=$ks"
      echo "ERO_KEYSTORE_PASSWORD<<ERO_END"
      printf '%s\n' "$ERO_KEYSTORE_PASSWORD"
      echo "ERO_END"
      echo "ERO_KEY_ALIAS<<ERO_END"
      printf '%s\n' "$ERO_KEY_ALIAS"
      echo "ERO_END"
      echo "ERO_KEY_PASSWORD<<ERO_END"
      printf '%s\n' "$ERO_KEY_PASSWORD"
      echo "ERO_END"
      echo "ERO_CERT_SHA256<<ERO_END"
      printf '%s\n' "$fp"
      echo "ERO_END"
    } >> "$GITHUB_ENV"
  fi
}

make_keystore() {
  local ks="$1" passfile="$2" store
  store="$(openssl rand -hex 24)"
  mask "$store"
  keytool -genkeypair -keystore "$ks" -storetype PKCS12 -storepass "$store" -alias ero -keypass "$store" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=ERO, OU=ERO, O=ERO, L=Kocaeli, C=TR" >/dev/null 2>&1
  printf 'alias=ero\nstore=%s\nkey=%s\n' "$store" "$store" > "$passfile"
  chmod 600 "$passfile" "$ks"
  ERO_KEY_ALIAS="ero"
  ERO_KEYSTORE_PASSWORD="$store"
  ERO_KEY_PASSWORD="$store"
}

unpack_bundle() {
  local enc="$1" work="$2" ks="$3"
  mkdir -p "$work"
  if ! decrypt_file "$enc" "$work/signing.tar"; then
    echo "Could not decrypt signing.enc. Refusing to mint a second key. If GEMINI_API_KEY changed, set ERO_SIGNING_PASSPHRASE to the passphrase that created this bundle." >&2
    exit 1
  fi
  tar -xf "$work/signing.tar" -C "$work"
  if [ ! -f "$work/ero.jks" ] || [ ! -f "$work/pass.txt" ]; then
    echo "The signing bundle does not contain the keystore." >&2
    exit 1
  fi
  mv "$work/ero.jks" "$ks"
  read_passfile "$work/pass.txt"
}

self_test() {
  local tmp fp1 fp2
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  export GEMINI_API_KEY="self-test-material"
  unset ERO_SIGNING_PASSPHRASE || true
  mkdir -p "$tmp/src"
  make_keystore "$tmp/src/ero.jks" "$tmp/src/pass.txt"
  tar -C "$tmp/src" -cf "$tmp/signing.tar" ero.jks pass.txt
  encrypt_file "$tmp/signing.tar" "$tmp/signing.enc"
  unpack_bundle "$tmp/signing.enc" "$tmp/a" "$tmp/a.jks"
  fp1="$(cert_sha "$tmp/a.jks")"
  unpack_bundle "$tmp/signing.enc" "$tmp/b" "$tmp/b.jks"
  fp2="$(cert_sha "$tmp/b.jks")"
  if [ -z "$fp1" ] || [ "$fp1" != "$fp2" ]; then
    echo "Signing self-test did not reproduce the certificate." >&2
    exit 1
  fi
  GEMINI_API_KEY="different-material"
  if decrypt_file "$tmp/signing.enc" "$tmp/bad.tar" 2>/dev/null; then
    echo "A different GEMINI_API_KEY opened the signing bundle." >&2
    exit 1
  fi
  export ERO_SIGNING_PASSPHRASE="priority-passphrase"
  GEMINI_API_KEY="ignored-while-passphrase-is-set"
  encrypt_file "$tmp/signing.tar" "$tmp/from-pass.enc"
  GEMINI_API_KEY="still-ignored"
  unpack_bundle "$tmp/from-pass.enc" "$tmp/c" "$tmp/c.jks"
  fp2="$(cert_sha "$tmp/c.jks")"
  if [ "$fp1" != "$fp2" ]; then
    echo "ERO_SIGNING_PASSPHRASE did not round-trip the same certificate." >&2
    exit 1
  fi
  unset ERO_SIGNING_PASSPHRASE
  echo "signing self-test ok"
}

use_secret_keystore() {
  local ks="$1"
  mask "${ERO_KEYSTORE_BASE64:-}"
  mask "${ERO_KEYSTORE_PASSWORD:-}"
  mask "${ERO_KEY_ALIAS:-}"
  mask "${ERO_KEY_PASSWORD:-}"
  printf '%s' "$ERO_KEYSTORE_BASE64" | tr -d ' \n\r' | base64 -d > "$ks"
  chmod 600 "$ks"
  echo "Release keystore secrets are available."
  publish_env "$ks"
}

download_bundle() {
  local work="$1"
  gh release download signing-key --repo "$GITHUB_REPOSITORY" --pattern signing.enc --dir "$work" --clobber
}

create_bundle() {
  local work="$1" ks="$2"
  mkdir -p "$work/new"
  make_keystore "$work/new/ero.jks" "$work/new/pass.txt"
  tar -C "$work/new" -cf "$work/signing.tar" ero.jks pass.txt
  encrypt_file "$work/signing.tar" "$work/signing.enc"
  if gh release create signing-key "$work/signing.enc" \
    --repo "$GITHUB_REPOSITORY" \
    --prerelease \
    --title "ERO signing key" \
    --notes "Encrypted release keystore. This is not an app update."; then
    echo "Stored a new encrypted signing bundle."
    cp "$work/new/ero.jks" "$ks"
    read_passfile "$work/new/pass.txt"
    publish_env "$ks"
    return
  fi
  echo "The signing bundle was stored by another run. Using that one."
  rm -rf "$work/got"
  mkdir -p "$work/got"
  download_bundle "$work/got"
  unpack_bundle "$work/got/signing.enc" "$work/got" "$ks"
  publish_env "$ks"
}

main() {
  local work ks
  mask "${GEMINI_API_KEY:-}"
  mask "${ERO_SIGNING_PASSPHRASE:-}"
  work="${RUNNER_TEMP:-/tmp}/ero-sign-$$"
  rm -rf "$work"
  mkdir -p "$work"
  ks="$work/ero.keystore"
  if [ -n "${ERO_KEYSTORE_BASE64:-}" ] && [ -n "${ERO_KEYSTORE_PASSWORD:-}" ] && [ -n "${ERO_KEY_ALIAS:-}" ] && [ -n "${ERO_KEY_PASSWORD:-}" ]; then
    use_secret_keystore "$ks"
    return
  fi
  echo "Release keystore secrets are empty. Using the encrypted signing bundle."
  if [ -n "${ERO_SIGNING_PASSPHRASE:-}" ]; then
    echo "ERO_SIGNING_PASSPHRASE is set and takes priority."
  elif [ -n "${GEMINI_API_KEY:-}" ]; then
    echo "Signing passphrase is derived from GEMINI_API_KEY."
  fi
  if download_bundle "$work" 2>"$work/download.err"; then
    echo "Encrypted signing bundle found."
    unpack_bundle "$work/signing.enc" "$work" "$ks"
    publish_env "$ks"
    return
  fi
  echo "No signing bundle yet."
  create_bundle "$work" "$ks"
}

if [ "${1:-}" = "self-test" ]; then
  self_test
  exit 0
fi

main
