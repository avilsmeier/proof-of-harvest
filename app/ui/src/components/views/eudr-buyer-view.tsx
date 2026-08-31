import { useState } from "react";
import { pureCircuits } from "proof-of-harvest-api";
import { useContract } from "@/providers/contract-provider";
import { useDemoStore } from "@/hooks/use-demo-store";
import { BUYER_ID, nowSeconds } from "@/lib/demo-seed";
import { bytesToHex, randomBytes32, truncateHex } from "@/lib/hex";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DisclosurePanel } from "@/components/disclosure-panel";
import { CheckCircle2, Loader2 } from "lucide-react";

export function EudrBuyerView() {
  const { contractAddress, getRoleHandle } = useContract();
  const [store, updateStore] = useDemoStore();
  const producerKeys = Object.keys(store.producers).filter((k) => store.producers[k]!.signature);
  const [selected, setSelected] = useState<string | null>(producerKeys[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDisclosureNotice, setShowDisclosureNotice] = useState(false);

  if (!contractAddress) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not set up yet</CardTitle>
          <CardDescription>Waiting for the exporter to deploy the program.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!selected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No issued credentials yet</CardTitle>
          <CardDescription>
            This bonus view reuses a producer&apos;s existing financing credential for origin and
            traceability evidence — issue one first from the Exporter Console.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const producer = store.producers[selected]!;

  async function requestEvidence() {
    setBusy(true);
    setError(null);
    try {
      if (!producer.signature || !producer.issuerId || !store.supplierList) {
        throw new Error("This producer's credential is not fully issued yet.");
      }
      const handle = await getRoleHandle(`producer:${selected}`, {
        localSecretKey: randomBytes32(),
        heldCredential: { credential: producer.credential, signature: producer.signature, issuerId: producer.issuerId },
        authorizedSuppliers: store.supplierList,
      });
      const asOfDate = nowSeconds();
      const txData = await handle.callTx.proveEudrEvidence(BUYER_ID, asOfDate);

      const evidenceRef = pureCircuits.eudrEvidenceRef(
        store.policy!.policyId,
        producer.credential.producerSecretId,
        producer.credential.campaignId,
        BUYER_ID,
      );

      updateStore((s) => ({
        ...s,
        producers: {
          ...s.producers,
          [selected!]: {
            ...s.producers[selected!]!,
            lastEudr: {
              evidenceRef: bytesToHex(evidenceRef),
              buyerId: bytesToHex(BUYER_ID),
              txId: txData.public.txId,
              when: Date.now(),
            },
          },
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^PoH:\s*/i, "") : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Select a fictional lot</CardTitle>
          <CardDescription>
            This bonus flow reuses the same signed evidence used for financing — no separate certification
            is issued, and no financial fields are read.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {producerKeys.map((key) => (
            <Button key={key} variant={key === selected ? "default" : "outline"} size="sm" onClick={() => setSelected(key)}>
              {store.producers[key]!.label}&apos;s lot
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Origin & traceability evidence</CardTitle>
          <CardDescription>Buyer: {truncateHex(bytesToHex(BUYER_ID))} (fictional EU roaster)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={requestEvidence} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Request origin & traceability evidence
          </Button>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {producer.lastEudr && (
            <>
              <Alert variant="success">
                <CheckCircle2 />
                <AlertDescription>
                  Origin and traceability evidence passed the requested policy. Detailed records are
                  available through authorized disclosure.
                </AlertDescription>
              </Alert>
              <DisclosurePanel
                verified={[
                  "Plot registered: YES",
                  "Origin policy: PASSED",
                  "Deforestation rule evidence: PRESENT",
                  "Traceability evidence: COMPLETE",
                  "Authorized issuers: VALID",
                ]}
                notDisclosed={["Campaign history", "Requested financing amount", "Estimated harvest value", "Other obligations"]}
              />
              <Button size="sm" variant="outline" onClick={() => setShowDisclosureNotice(true)}>
                Request authorized disclosure (simulated)
              </Button>
              {showDisclosureNotice && (
                <Alert>
                  <AlertDescription>
                    In a real deployment, a compliance-authorized buyer would request full coordinates and
                    supporting documents through an audited, off-chain disclosure channel — not part of
                    this hackathon MVP, and not a substitute for the EUDR due-diligence disclosures the
                    regulation itself requires.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
