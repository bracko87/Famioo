# Famioo privacy and client-side encryption model

## Current production state

Famioo uses authenticated household membership, row-level security, private storage buckets and HTTPS/TLS. This prevents public access and limits records to authorized household members.

This is **not yet the same as end-to-end/client-side encryption** for all structured Famioo data. Existing Household Costs amounts, School/Kita records, Shopping text, Home Care records, Life Admin records and other structured fields still need a staged migration before Famioo can truthfully say that the server only sees ciphertext.

## Target model

The target is a zero-knowledge style household encryption layer for sensitive content:

1. A 256-bit household data key is generated on an authorized device.
2. The raw household key never goes to Supabase.
3. Each device has its own local private key. Only its public key is stored server-side.
4. The household key is wrapped separately for each authorized device/member using ECDH + HKDF + AES-GCM.
5. File/photo bytes are encrypted in the browser/app before upload.
6. Sensitive structured payloads are serialized and encrypted with AES-GCM before database write.
7. Supabase stores ciphertext, IV, algorithm/version metadata, and the minimum metadata needed for sync/permissions.
8. Decryption happens only on an authorized device holding a private device key.
9. A recovery mechanism must exist before full activation. Losing every device/private key without a recovery key would otherwise make encrypted family data unrecoverable.

## Prepared database structures

Migration 049 prepares:
- household encryption mode and key version
- per-device public keys
- wrapped household keys per device
- generic encrypted data envelopes for module records
- encryption metadata on Files

No plaintext encryption key is stored in these tables.

## Rollout order

1. Files/photos: encrypt binary bytes before upload, decrypt to memory/object URL on device.
2. Life Admin and School/Kita attachments.
3. Household Costs sensitive values and notes.
4. Life Admin/Home Care/School structured private text.
5. Shopping/checklist/task private notes where selected by product policy.
6. Remaining modules.

The rollout should not mark a module as E2EE until reads, writes, sharing, recovery, new-device enrollment, key rotation, archive/export and deletion all work with encrypted content.

## Search, totals and reminders

End-to-end encryption changes server-side features. For encrypted monetary amounts, totals must be calculated on-device (or use explicitly designed privacy-preserving derived values). For encrypted text, server-side full-text search is unavailable unless a separate encrypted index strategy is introduced. Notifications should avoid leaking sensitive plaintext in push/email content unless the user explicitly allows it.

## Product wording

Until a module is fully migrated, UI text must say that it is private and access-controlled, not that it is end-to-end encrypted. Once active, the wording can change to “Encrypted on your device before upload; Famioo stores ciphertext only.”
