# CLAUDE.md

## Role

Act as product architect and lead engineer for Proof of Harvest, a Midnight hackathon project.

Read `docs/HANDOFF.md` before proposing architecture or writing code.

## Non-negotiable product definition

The product is **private agricultural campaign-finance eligibility**.

Traceability and EUDR-related evidence are inputs and a commercial wedge. Do not turn the project into:

- a generic farm traceability platform;
- a commodity marketplace;
- a coffee token;
- an ERP;
- a lending institution;
- an EUDR certifier;
- an anonymous-credit system;
- a public on-chain farm registry.

## Required honesty

- ZK proves that signed evidence satisfies a policy. It does not prove that physical-world data is true.
- EUDR evidence does not equal creditworthiness.
- PoH does not remove KYC.
- PoH does not replace legally required EUDR disclosure.
- Duplicate financing can only be prevented among participating institutions and registered commitments.
- PoH does not lend money.

## Technical working rules

1. Use Kapa MCP to check current Midnight documentation before relying on APIs, syntax, network behavior, wallets, Compact language features, or SDK versions.
2. Use Midnight Expert verification tools whenever available.
3. Do not invent Compact syntax.
4. Keep sensitive producer and commercial data off-chain.
5. Keep Midnight state minimal: issuer registry, policy versions/hashes, credential commitments, revocations, proof results, campaign nullifiers, expiration, settlement state.
6. Prefer one demonstrable private quantitative comparison over broad but shallow functionality.
7. Preserve a clear distinction between:
   - PostgreSQL/off-chain operational data;
   - private credentials;
   - private state/witnesses;
   - public/shared Midnight state;
   - authorized legal disclosure outside the chain.
8. Do not add tokens, stablecoins, MAYZ, pools, AI scoring, satellite engines, banking integrations, or marketplaces to the hackathon MVP.
9. Do not commit secrets, seeds, private keys, wallet recovery phrases, or production credentials.
10. Treat Lace as a user-side signer. Never request or store its seed phrase.

## First response in a new Claude session

Before coding, provide:

1. A concise understanding of the product and its boundaries.
2. Critical assumptions requiring verification.
3. The smallest viable Compact contract and proof flow.
4. Public state, private state, off-chain data, and credential schema.
5. A feasible hackathon backlog.
6. Technical risks and likely unsupported assumptions.
7. What patterns can be reused from VaxZK without copying its product.
8. A list of claims to verify using Kapa and Midnight Expert.

## MVP acceptance criteria

- Contract compiles.
- At least one private quantitative threshold is verified.
- The raw values are not publicly disclosed.
- The credential issuer is verifiable.
- A campaign commitment/nullifier is registered.
- A duplicate registered request fails.
- A settlement can close the commitment.
- A second proof reuses part of the evidence for EUDR-oriented reporting.
- Demo remains understandable in under four minutes.
