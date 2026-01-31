import os
import base64
import json
from dataclasses import dataclass
from typing import Dict, Tuple

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes


# ----------------------------
# Helpers: encode/decode
# ----------------------------
def b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("utf-8").rstrip("=")

def b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


# ----------------------------
# KDF: derive sub-keys deterministically
# ----------------------------
def derive_subkey(master_key: bytes, provider: str, token_type: str, key_version: int) -> bytes:
    """
    Deterministic: same (master_key, provider, token_type, key_version) => same derived key.
    """
    info = f"provider={provider}|type={token_type}|kv={key_version}".encode("utf-8")

    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,               # 32 bytes => AES-256 key
        salt=None,               # OK if master_key is already high-entropy
        info=info,
    )
    return hkdf.derive(master_key)


# ----------------------------
# AAD: bind ciphertext to context
# ----------------------------
def build_aad(workspace_id: str, provider: str, token_type: str) -> bytes:
    """
    AAD is not secret. It's "context binding".
    If any of these values change, decrypt will fail.
    """
    aad_obj = {
        "workspace_id": workspace_id,
        "provider": provider,
        "token_type": token_type,
    }
    # stable encoding (sort keys)
    return json.dumps(aad_obj, sort_keys=True, separators=(",", ":")).encode("utf-8")


# ----------------------------
# Token vault record (what you store in DB)
# ----------------------------
@dataclass
class TokenRow:
    workspace_id: str
    provider: str
    token_type: str
    key_version: int
    nonce_b64: str
    ciphertext_b64: str
    expires_at: str | None = None  # optional


# ----------------------------
# Encrypt / Decrypt
# ----------------------------
def encrypt_token(*, master_key: bytes, workspace_id: str, provider: str, token_type: str,
                  key_version: int, plaintext_token: str) -> TokenRow:
    # 1) derive key
    subkey = derive_subkey(master_key, provider, token_type, key_version)

    # 2) build aad
    aad = build_aad(workspace_id, provider, token_type)

    # 3) generate nonce (random, new every time)
    nonce = os.urandom(12)  # 12 bytes is standard for AES-GCM

    # 4) encrypt
    aesgcm = AESGCM(subkey)
    ciphertext = aesgcm.encrypt(nonce, plaintext_token.encode("utf-8"), aad)
    # NOTE: ciphertext includes auth tag at the end (handled by library)

    return TokenRow(
        workspace_id=workspace_id,
        provider=provider,
        token_type=token_type,
        key_version=key_version,
        nonce_b64=b64e(nonce),
        ciphertext_b64=b64e(ciphertext),
    )


def decrypt_token(*, master_key: bytes, row: TokenRow) -> str:
    # 1) derive key using row metadata
    subkey = derive_subkey(master_key, row.provider, row.token_type, row.key_version)

    # 2) rebuild the same aad
    aad = build_aad(row.workspace_id, row.provider, row.token_type)

    # 3) decrypt using stored nonce + ciphertext
    nonce = b64d(row.nonce_b64)
    ciphertext = b64d(row.ciphertext_b64)

    aesgcm = AESGCM(subkey)
    plaintext = aesgcm.decrypt(nonce, ciphertext, aad)

    return plaintext.decode("utf-8")


# ----------------------------
# Demo
# ----------------------------
def main():
    # MASTER KEY (normally from env). Must be 32 random bytes.
    # Example env: TOKEN_ENCRYPTION_KEY_B64=... (urlsafe base64)
    master_key = os.urandom(32)

    workspace_a = "workspace-A-uuid"
    workspace_b = "workspace-B-uuid"

    google_refresh = "1//0gMockGoogleRefreshToken"
    meta_long = "EAABMockMetaLongLivedToken"

    # Encrypt two tokens
    row_google = encrypt_token(
        master_key=master_key,
        workspace_id=workspace_a,
        provider="google",
        token_type="refresh",
        key_version=1,
        plaintext_token=google_refresh,
    )

    row_meta = encrypt_token(
        master_key=master_key,
        workspace_id=workspace_a,
        provider="meta",
        token_type="access_long_lived",
        key_version=1,
        plaintext_token=meta_long,
    )

    print("\n--- STORED ROW (GOOGLE) ---")
    print(row_google)
    # Example output (will differ every run):
    # nonce_b64='nwM2cJQp0q0rKXkA', ciphertext_b64='...'

    print("\n--- DECRYPT (GOOGLE) ---")
    print(decrypt_token(master_key=master_key, row=row_google))  # should match original

    print("\n--- STORED ROW (META) ---")
    print(row_meta)

    print("\n--- DECRYPT (META) ---")
    print(decrypt_token(master_key=master_key, row=row_meta))

    # Demonstrate AAD protection: copy ciphertext to another workspace
    print("\n--- ATTACK/BUG DEMO: SWAP WORKSPACE_ID (should fail) ---")
    swapped = TokenRow(**{**row_google.__dict__, "workspace_id": workspace_b})
    try:
        print(decrypt_token(master_key=master_key, row=swapped))
    except Exception as e:
        print("Decrypt failed as expected:", type(e).__name__, str(e))

    # Demonstrate KDF separation: change provider (should fail)
    print("\n--- ATTACK/BUG DEMO: CHANGE PROVIDER (should fail) ---")
    wrong_provider = TokenRow(**{**row_google.__dict__, "provider": "meta"})
    try:
        print(decrypt_token(master_key=master_key, row=wrong_provider))
    except Exception as e:
        print("Decrypt failed as expected:", type(e).__name__, str(e))


if __name__ == "__main__":
    main()
