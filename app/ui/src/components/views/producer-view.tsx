import { useState } from "react";
import { pureCircuits } from "proof-of-harvest-api";
import { useContract } from "@/providers/contract-provider";
import { useDemoStore } from "@/hooks/use-demo-store";
import { FINANCIER_ID, nowSeconds } from "@/lib/demo-seed";
import { bytesToHex, randomBytes32 } from "@/lib/hex";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DisclosurePanel } from "@/components/disclosure-panel";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

/** Strips the internal "PoH:" assert-message prefix for a plainer-language read. */
function friendlyReason(message: string): string {
  const stripped = message.replace(/^PoH:\s*/i, "");
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function ProducerView() {
  const { contractAddress, getRoleHandle } = useContract();
  const [store, updateStore] = useDemoStore();
  const producerKeys = Object.keys(store.producers);
  const [selected, setSelected] = useState<string | null>(producerKeys[0] ?? null);
  const [busy, setBusy] = useState(false);

  if (!contractAddress) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not set up yet</CardTitle>
          <CardDescription>
            Your exporter hasn&apos;t finished setting up the campaign-finance program yet. Check back
            soon, or ask them to complete the Exporter Console setup step.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (producerKeys.length === 0 || !selected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No producer profiles yet</CardTitle>
          <CardDescription>Ask your exporter to complete setup — this seeds the demo producer profiles.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const producer = store.producers[selected]!;

  async function requestSupport() {
    setBusy(true);
    try {
      const supplierList = store.supplierList;
      if (!supplierList) throw new Error("The program's authorized supplier list is not available yet.");
      if (!producer.signature || !producer.issuerId) {
        throw new Error("Your credential hasn't been issued yet.");
      }

      const handle = await getRoleHandle(`producer:${selected}`, {
        localSecretKey: randomBytes32(), // unused by this circuit; required by the shared private-state shape
        heldCredential: { credential: producer.credential, signature: producer.signature, issuerId: producer.issuerId },
        authorizedSuppliers: supplierList,
      });

      const asOfDate = nowSeconds(); // must be computed fresh at call time — see lib/demo-seed.ts
      const txData = await handle.callTx.proveCampaignEligibility(FINANCIER_ID, producer.requestedValue, asOfDate);

      const nullifier = pureCircuits.campaignNullifier(
        store.policy!.policyId,
        producer.credential.producerSecretId,
        producer.credential.campaignId,
      );

      updateStore((s) => ({
        ...s,
        producers: {
          ...s.producers,
          [selected!]: {
            ...s.producers[selected!]!,
            lastEligibility: {
              nullifier: bytesToHex(nullifier),
              eligible: true,
              txId: txData.public.txId,
              when: Date.now(),
            },
          },
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateStore((s) => ({
        ...s,
        producers: {
          ...s.producers,
          [selected!]: {
            ...s.producers[selected!]!,
            lastEligibility: { nullifier: "", eligible: false, error: friendlyReason(message), when: Date.now() },
          },
        },
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Choose a producer profile</CardTitle>
          <CardDescription>Fictional demo profiles standing in for a real producer&apos;s own device.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {producerKeys.map((key) => (
            <Button
              key={key}
              variant={key === selected ? "default" : "outline"}
              size="sm"
              onClick={() => setSelected(key)}
            >
              {store.producers[key]!.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{producer.label}&apos;s campaign</CardTitle>
          <CardDescription>{producer.narrative}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            Requesting <span className="font-semibold">S/{producer.requestedValue.toString()}</span> of
            campaign support.
          </div>

          {!producer.signature ? (
            <Alert>
              <AlertDescription>
                Your exporter hasn&apos;t issued your campaign credential yet. Once they do, you can
                request support here.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Button onClick={requestSupport} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                Request campaign support
              </Button>
              <p className="text-xs text-muted-foreground">
                Your exporter will approve this in the background. You will not need to share your farm
                details, your delivery history, or your prices — the financing partner only learns whether
                you qualify.
              </p>
            </>
          )}

          {producer.lastEligibility && (
            <div className="pt-2 space-y-4">
              {producer.lastEligibility.eligible ? (
                <>
                  <Alert variant="success">
                    <CheckCircle2 />
                    <AlertDescription>
                      Your campaign request is eligible. The financing partner did not receive your farm
                      coordinates, delivery volumes or negotiated prices.
                    </AlertDescription>
                  </Alert>
                  <DisclosurePanel
                    verified={[
                      "Sufficient campaign history",
                      "Sufficient production capacity for this request",
                      "Valid, current productive credential",
                      "Campaign available (not already committed elsewhere)",
                    ]}
                    notDisclosed={[
                      "Your name and location",
                      "Exact farm coordinates",
                      "Delivery volumes and history",
                      "Negotiated prices",
                    ]}
                  />
                  <Button size="sm" variant="outline" onClick={requestSupport} disabled={busy}>
                    Try requesting again (should now be rejected — same campaign)
                  </Button>
                </>
              ) : (
                <Alert variant="destructive">
                  <XCircle />
                  <AlertDescription>
                    Your request was not approved: {producer.lastEligibility.error}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {producer.lastEligibility?.eligible && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">Reserved — awaiting harvest settlement</Badge>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
