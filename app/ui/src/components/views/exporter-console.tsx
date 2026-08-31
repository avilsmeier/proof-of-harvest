import { useState } from "react";
import { signCredential, signSettlement, type ContractState } from "proof-of-harvest-api";
import { useContract } from "@/providers/contract-provider";
import { useDemoStore } from "@/hooks/use-demo-store";
import { buildDemoProducers, buildPolicy, buildSupplierList, generateIssuerKeyPair } from "@/lib/demo-seed";
import { bytesToHex, hexToBytes, id32, randomBytes32, truncateHex } from "@/lib/hex";
import { entriesOf } from "@/lib/ledger";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";

/** Reads (or lazily creates and persists) the registry admin's local secret. */
function useAdminSecret() {
  const [store, updateStore] = useDemoStore();
  const ensure = (): Uint8Array => {
    if (store.adminSecretHex) return hexToBytes(store.adminSecretHex);
    const fresh = randomBytes32();
    updateStore((s) => ({ ...s, adminSecretHex: bytesToHex(fresh) }));
    return fresh;
  };
  return { ensure };
}

export function ExporterConsole() {
  const { contractAddress, ledgerState, deploying, deployError, deploy, getRoleHandle, forgetContract } = useContract();
  const [store, updateStore] = useDemoStore();
  const { ensure: ensureAdminSecret } = useAdminSecret();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newIssuerLabel, setNewIssuerLabel] = useState("");

  async function handleDeploy() {
    setActionError(null);
    try {
      const adminSecret = ensureAdminSecret();
      const supplierList = store.supplierList ?? buildSupplierList();
      const policy = store.policy ?? buildPolicy(supplierList);
      const issuer = store.issuer ?? { idHex: bytesToHex(id32("ISS-EXPORTER-DEMO")), keyPair: generateIssuerKeyPair() };
      const producers = Object.keys(store.producers).length > 0 ? store.producers : buildDemoProducers(supplierList[0]!);

      updateStore((s) => ({ ...s, supplierList, policy, issuer, producers }));

      await deploy(policy, adminSecret);

      // Register the exporter's own issuer immediately so credentials can be
      // issued right away — otherwise the console would deploy into an empty
      // registry and every subsequent action would fail with "issuer is not
      // registered" until a separate manual step ran.
      setBusy("Registering the exporter as an authorized issuer…");
      const handle = await getRoleHandle("exporter", { localSecretKey: adminSecret });
      await handle.callTx.registerIssuer(hexToBytes(issuer.idHex), issuer.keyPair.publicKey);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // Repairs the case where `store.issuer` (the identity `handleIssueCredential`
  // actually signs with) was never registered on-chain under its real id/key —
  // e.g. because the auto-registration step in `handleDeploy` failed and the
  // free-text "Register issuer" box below was used instead, which always mints
  // an unrelated random keypair rather than reusing `store.issuer`.
  async function handleRegisterSelfAsIssuer() {
    if (!store.issuer) return;
    setActionError(null);
    setBusy("Re-registering the exporter's own issuer identity…");
    try {
      const adminSecret = ensureAdminSecret();
      const handle = await getRoleHandle("exporter", { localSecretKey: adminSecret });
      await handle.callTx.registerIssuer(hexToBytes(store.issuer.idHex), store.issuer.keyPair.publicKey);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRegisterIssuer() {
    if (!newIssuerLabel.trim()) return;
    setActionError(null);
    setBusy(`Registering issuer "${newIssuerLabel}"…`);
    try {
      const adminSecret = ensureAdminSecret();
      const handle = await getRoleHandle("exporter", { localSecretKey: adminSecret });
      const keyPair = generateIssuerKeyPair();
      const issuerId = id32(newIssuerLabel.trim());
      await handle.callTx.registerIssuer(issuerId, keyPair.publicKey);
      setNewIssuerLabel("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRevokeIssuer(issuerIdHex: string) {
    setActionError(null);
    setBusy(`Revoking issuer ${truncateHex(issuerIdHex)}…`);
    try {
      const adminSecret = ensureAdminSecret();
      const handle = await getRoleHandle("exporter", { localSecretKey: adminSecret });
      await handle.callTx.revokeIssuer(hexToBytes(issuerIdHex));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleIssueCredential(producerKey: string) {
    if (!store.issuer || !ledgerState) return;
    setActionError(null);
    setBusy(`Signing ${store.producers[producerKey]?.label}'s credential…`);
    try {
      const producer = store.producers[producerKey]!;
      const signature = signCredential(store.issuer.keyPair, producer.credential, ledgerState.policyHash);
      updateStore((s) => ({
        ...s,
        producers: {
          ...s.producers,
          [producerKey]: { ...producer, signature, issuerId: hexToBytes(s.issuer!.idHex) },
        },
      }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSettle(nullifierHex: string) {
    if (!store.issuer || !ledgerState) return;
    setActionError(null);
    setBusy(`Registering settlement for ${truncateHex(nullifierHex)}…`);
    try {
      const adminSecret = ensureAdminSecret();
      const nullifier = hexToBytes(nullifierHex);
      const signature = signSettlement(store.issuer.keyPair, nullifier, ledgerState.policyHash);
      const handle = await getRoleHandle("exporter", {
        localSecretKey: adminSecret,
        settlementAttestation: { signature, issuerId: hexToBytes(store.issuer.idHex) },
      });
      await handle.callTx.settleCampaign(nullifier);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (!contractAddress) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Deploy the campaign-finance policy</CardTitle>
            <CardDescription>
              This is a one-time setup step. It seals a versioned financing policy — minimum campaign
              history, the maximum request-to-settlement ratio, and the authorized supplier set — into a
              new contract instance on Midnight Preprod, then registers this exporter as the first
              authorized evidence issuer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm space-y-1 rounded-md border p-3 bg-muted/30">
              <div className="font-medium">Policy FIN-COFFEE-2027-v1 (fictional)</div>
              <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                <li>At least 2 campaigns of delivery history</li>
                <li>Requested support at most 20% of estimated harvest settlement</li>
                <li>Supplier must be on the authorized supplier list</li>
              </ul>
            </div>
            {deployError && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Deployment failed</AlertTitle>
                <AlertDescription>{deployError}</AlertDescription>
              </Alert>
            )}
            {actionError && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Setup failed</AlertTitle>
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            )}
            <Button onClick={handleDeploy} disabled={deploying || busy !== null}>
              {(deploying || busy) && <Loader2 className="animate-spin" />}
              {deploying ? "Deploying…" : (busy ?? "Deploy contract")}
            </Button>
          </CardContent>
        </Card>
        <ConnectExisting />
      </div>
    );
  }

  const producers = Object.entries(store.producers);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-600" />
            Contract deployed
          </CardTitle>
          <CardDescription className="font-mono text-xs break-all">{contractAddress}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={forgetContract}>
            Forget this contract (local only)
          </Button>
        </CardContent>
      </Card>

      {(actionError || busy) && (
        <Alert variant={actionError ? "destructive" : "default"}>
          {actionError ? <AlertTriangle /> : <Loader2 className="animate-spin" />}
          <AlertDescription>{actionError ?? busy}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Authorized issuers</CardTitle>
          <CardDescription>Only signatures from a registered, active issuer satisfy a credential check.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <IssuerTable ledgerState={ledgerState} onRevoke={handleRevokeIssuer} busy={busy !== null} />
          {store.issuer && (
            <Button variant="outline" size="sm" onClick={handleRegisterSelfAsIssuer} disabled={busy !== null}>
              Register/repair my exporter issuer identity
            </Button>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="New issuer label, e.g. ISS-CERTIFIER-DEMO"
              value={newIssuerLabel}
              onChange={(e) => setNewIssuerLabel(e.target.value)}
            />
            <Button onClick={handleRegisterIssuer} disabled={busy !== null || !newIssuerLabel.trim()}>
              Register issuer
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Producer credentials</CardTitle>
          <CardDescription>
            Fictional demo producers (HANDOFF.md §5/§10.1). Issuing signs each producer&apos;s private
            productive credential so it can be proven against the policy without publishing it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {producers.map(([key, producer]) => (
            <div key={key} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="font-medium">{producer.label}</div>
                <div className="text-xs text-muted-foreground max-w-md">{producer.narrative}</div>
              </div>
              {producer.signature ? (
                <Badge variant="secondary">Issued</Badge>
              ) : (
                <Button size="sm" onClick={() => handleIssueCredential(key)} disabled={busy !== null || !store.issuer}>
                  Issue credential
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered campaign commitments</CardTitle>
          <CardDescription>
            One row appears per approved request. A settled row cannot be reused; a reserved row blocks
            any further request against the same campaign.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CommitmentsTable ledgerState={ledgerState} onSettle={handleSettle} busy={busy !== null} />
        </CardContent>
      </Card>
    </div>
  );
}

function IssuerTable({
  ledgerState,
  onRevoke,
  busy,
}: {
  ledgerState: ContractState | null;
  onRevoke: (issuerIdHex: string) => void;
  busy: boolean;
}) {
  if (!ledgerState || ledgerState.issuers.isEmpty()) {
    return <p className="text-sm text-muted-foreground">No issuers registered yet.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="pb-1 font-normal">Issuer id</th>
          <th className="pb-1 font-normal">Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {entriesOf(ledgerState.issuers).map(([id, record]) => {
          const idHex = bytesToHex(id);
          return (
            <tr key={idHex} className="border-t">
              <td className="py-1.5 font-mono text-xs">{truncateHex(idHex)}</td>
              <td className="py-1.5">
                <Badge variant={record.active ? "secondary" : "destructive"}>
                  {record.active ? "Active" : "Revoked"}
                </Badge>
              </td>
              <td className="py-1.5 text-right">
                {record.active && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => onRevoke(idHex)}>
                    Revoke
                  </Button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CommitmentsTable({
  ledgerState,
  onSettle,
  busy,
}: {
  ledgerState: ContractState | null;
  onSettle: (nullifierHex: string) => void;
  busy: boolean;
}) {
  if (!ledgerState || ledgerState.commitments.isEmpty()) {
    return <p className="text-sm text-muted-foreground">No campaigns have requested support yet.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="pb-1 font-normal">Nullifier</th>
          <th className="pb-1 font-normal">Status</th>
          <th className="pb-1 font-normal">Requested</th>
          <th className="pb-1 font-normal">As of</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {entriesOf(ledgerState.commitments).map(([nullifier, commitment]) => {
          const nullifierHex = bytesToHex(nullifier);
          const statusLabel = ["None", "Reserved", "Settled"][commitment.status] ?? "Unknown";
          return (
            <tr key={nullifierHex} className="border-t">
              <td className="py-1.5 font-mono text-xs">{truncateHex(nullifierHex)}</td>
              <td className="py-1.5">
                <Badge variant={commitment.status === 2 ? "secondary" : commitment.status === 1 ? "default" : "outline"}>
                  {statusLabel}
                </Badge>
              </td>
              <td className="py-1.5">{commitment.requestedValue.toString()}</td>
              <td className="py-1.5">{new Date(Number(commitment.provenAt) * 1000).toLocaleDateString()}</td>
              <td className="py-1.5 text-right">
                {commitment.status === 1 && (
                  <Button size="sm" disabled={busy} onClick={() => onSettle(nullifierHex)}>
                    Settle
                  </Button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ConnectExisting() {
  const [, updateStore] = useDemoStore();
  const [address, setAddress] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Already have a deployed contract?</CardTitle>
        <CardDescription>
          Connect to an existing Proof of Harvest deployment instead of deploying a new one — useful when
          rejoining a session from a different browser, or reconnecting after clearing local storage. Admin
          and issuer actions still require the secrets from the browser that originally deployed it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Input placeholder="Contract address (0x…)" value={address} onChange={(e) => setAddress(e.target.value)} />
        <Button
          variant="outline"
          disabled={!address.trim()}
          onClick={() => updateStore((s) => ({ ...s, contractAddress: address.trim() }))}
        >
          Connect
        </Button>
      </CardContent>
    </Card>
  );
}
