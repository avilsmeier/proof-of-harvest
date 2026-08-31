import { useState } from "react";
import { WalletProvider } from "@/providers/wallet-context";
import { MidnightProvidersProvider, useMidnightProviders } from "@/providers/midnight-providers";
import { ContractProvider } from "@/providers/contract-provider";
import { useWallet } from "@/hooks/use-wallet";
import { WalletWidget } from "@/components/wallet-widget";
import { NetworkBadge } from "@/components/network-badge";
import { ProofServerStatus } from "@/components/proof-server-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ExporterConsole } from "@/components/views/exporter-console";
import { ProducerView } from "@/components/views/producer-view";
import { FinancierDashboard } from "@/components/views/financier-dashboard";
import { EudrBuyerView } from "@/components/views/eudr-buyer-view";
import { AlertTriangle, Wallet } from "lucide-react";

const ROLES = [
  { id: "exporter", label: "Exporter Console" },
  { id: "producer", label: "Producer View" },
  { id: "financier", label: "Financier Dashboard" },
  { id: "buyer", label: "EUDR / Buyer (bonus)" },
] as const;

type RoleId = (typeof ROLES)[number]["id"];

export function App() {
  return (
    <WalletProvider>
      <MidnightProvidersProvider>
        <div className="min-h-screen bg-background">
          <header className="border-b">
            <div className="container mx-auto flex items-center justify-between px-4 py-3">
              <div>
                <h1 className="text-lg font-semibold">Proof of Harvest</h1>
                <p className="text-xs text-muted-foreground">Turning compliance data into private financial access</p>
              </div>
              <div className="flex items-center gap-3">
                <NetworkBadge />
                <ProofServerStatus />
                <WalletWidget />
              </div>
            </div>
          </header>
          <main className="container mx-auto px-4 py-8">
            <Gate />
          </main>
        </div>
      </MidnightProvidersProvider>
    </WalletProvider>
  );
}

/** Gates the app on wallet connection before assembling Midnight providers / the contract context. */
function Gate() {
  const wallet = useWallet();
  const { isReady, error: providersError } = useMidnightProviders();

  if (wallet.status !== "connected") {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Connect your wallet to continue</CardTitle>
          <CardDescription>
            Proof of Harvest runs entirely through your Midnight wallet (Lace or 1AM) — every role
            (exporter, producer, financier) signs and submits its own actions. Nothing here ever asks
            for or stores a seed phrase.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {wallet.status === "error" && wallet.error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Couldn&apos;t connect</AlertTitle>
              <AlertDescription>{wallet.error}</AlertDescription>
            </Alert>
          )}
          <Button onClick={wallet.connect} disabled={wallet.status === "connecting"}>
            <Wallet />
            {wallet.status === "connecting" ? "Connecting…" : "Connect to get started"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!isReady) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Setting up providers…</CardTitle>
          <CardDescription>Reading indexer, node and proof server endpoints from your wallet&apos;s configuration.</CardDescription>
        </CardHeader>
        {providersError && (
          <CardContent>
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>{providersError}</AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>
    );
  }

  return (
    <ContractProvider>
      <RoleTabs />
    </ContractProvider>
  );
}

function RoleTabs() {
  const [role, setRole] = useState<RoleId>("exporter");
  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2 border-b pb-4">
        {ROLES.map((r) => (
          <Button key={r.id} variant={r.id === role ? "default" : "ghost"} size="sm" onClick={() => setRole(r.id)}>
            {r.label}
          </Button>
        ))}
      </nav>
      {role === "exporter" && <ExporterConsole />}
      {role === "producer" && <ProducerView />}
      {role === "financier" && <FinancierDashboard />}
      {role === "buyer" && <EudrBuyerView />}
    </div>
  );
}
