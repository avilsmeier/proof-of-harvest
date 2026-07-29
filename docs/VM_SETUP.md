# VM bootstrap

Run from your home directory on the Linux VM.

```bash
cd ~/PoH

# Copy the contents of this bootstrap package into the existing folder,
# preserving any files already present:
cp -a /path/to/PoH_repo_bootstrap/. .

git status
git add README.md CLAUDE.md .mcp.json .gitignore docs contract app mock-data pitch
git commit -m "Initialize Proof of Harvest project documentation"
```

## Configure Kapa globally too

```bash
claude mcp add --transport http --scope user midnight https://midnight.mcp.kapa.ai
claude mcp list
```

## Install Midnight Expert

```bash
curl -fsSL https://midnightntwrk.expert/install.sh | bash
```

Restart Claude Code, then run:

```text
/midnight-expert:doctor
```

## Start the project

```bash
cd ~/PoH
tmux new -s poh
claude
```

First prompt:

```text
Read CLAUDE.md and docs/HANDOFF.md completely. Then follow the required first-response checklist in CLAUDE.md. Use Kapa to verify all current Midnight-specific assumptions before proposing implementation details.
```
