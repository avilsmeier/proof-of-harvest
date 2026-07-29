# Proof of Harvest (PoH)

**Turning compliance data into private financial access.**

Proof of Harvest is a Midnight-based hackathon project focused on private, verifiable eligibility for agricultural campaign finance. It reuses production, delivery-history, certification, and traceability evidence without exposing the farmer's identity, exact farm coordinates, volumes, prices, or the exporter's commercial relationships.

## Start here

1. Read [`docs/HANDOFF.md`](docs/HANDOFF.md).
2. Read [`CLAUDE.md`](CLAUDE.md).
3. Run Claude Code from this repository root.
4. Ask Claude to review the current Midnight documentation through Kapa before proposing implementation details.
5. Do not begin final hackathon code until the event rules on pre-existing work are confirmed.

## Core product thesis

Traceability is not the product. It is underwriting evidence.

> Traceability should not only prove where a product came from. It should help the farmer who produced it access capital.

## Target hackathon MVP

- Authorized issuer
- Private productive credential
- Quantitative private eligibility rule
- Campaign commitment/nullifier
- Rejection of duplicate registered financing
- Simulated harvest settlement
- Secondary EUDR evidence proof
- Clear disclosure of what was verified and what remained private

## Architecture

```text
Private operational data
        -> PostgreSQL / object storage

Signed evidence
        -> private credentials

Private rule evaluation
        -> zero-knowledge proof

Shared issuer, policy, revocation and commitment state
        -> Midnight
```

## Repository structure

```text
PoH/
├── README.md
├── CLAUDE.md
├── .mcp.json
├── .gitignore
├── docs/
│   ├── HANDOFF.md
│   └── CLAUDE_KICKOFF_PROMPT.txt
├── contract/
├── app/
├── mock-data/
└── pitch/
```

The source folders are intentionally empty until the technical architecture is validated against the current Midnight SDK and the hackathon rules.
