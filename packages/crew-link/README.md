# @opendeck/crew-link

The link between Fenna Crew on a computer and the person's phone: device
keys, the pairing code, the keys both sides agree on, and sealed messages.
Web Crypto only, so the same code runs in Crew's main process, the phone
app's WebView and the relay. The design is in
[docs/plans/crew-mobile.md](../../docs/plans/crew-mobile.md), section A.

| Function | |
| --- | --- |
| `newDevice`, `loadDevice`, `deviceIdOf` | A device's ECDSA and ECDH P-256 keys, and its id (hash of the ECDSA key) |
| `signChallenge`, `verifyChallenge` | Signing in to the relay |
| `makePairCode`, `parsePairCode` | The QR code's text (`fenna1.…`) |
| `pairRequest`, `openPairRequest` | The phone's request, sealed with the code's one-time secret |
| `pairKey`, `pushKeyRaw`, `importPushKey` | AES-GCM keys from ECDH + HKDF |
| `seal`, `open` | `1.<nonce>.<ciphertext>`, bound to the sender and receiver |
| `encodeValue`, `decodeValue` | ArrayBuffer and Uint8Array inside JSON |
