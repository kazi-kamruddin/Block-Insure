# Synthetic External Registry Boundary

Block-Insure uses a synthetic hospital registry for local thesis demos. The mock service stands in for an external hospital, invoice, and treatment verification provider so oracle disagreement, Merkle proof checks, and registry root commitments can be demonstrated without exposing real patient data.

The smart contract stores only the Merkle registry root and claim evidence hashes/CIDs. Full medical, NID, and private document content must remain off-chain. In a production integration, this mock registry would be replaced by a hospital API, signed data feed, or trusted data exchange. The replacement should still return privacy-safe verification outputs such as record identifiers, leaf hashes, proof paths, risk labels, and signed oracle attestations.

Client-side document encryption is scaffolded as an opt-in UI flag. It is disabled by default to preserve the existing evidence upload flow. Decryption keys must never be stored on-chain.
