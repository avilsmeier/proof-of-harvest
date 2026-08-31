import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WalletProvider } from "../providers/wallet-context";
import { useWallet } from "../hooks/use-wallet";

function TestConsumer() {
  const { status, walletName, shieldedAddress, error, connect, disconnect } = useWallet();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="wallet-name">{walletName ?? "none"}</span>
      <span data-testid="address">{shieldedAddress ?? "none"}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <button onClick={connect}>connect</button>
      <button onClick={disconnect}>disconnect</button>
    </div>
  );
}

describe("WalletContext", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as Record<string, unknown>).midnight;
  });

  it("starts disconnected", () => {
    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );
    expect(screen.getByTestId("status")).toHaveTextContent("disconnected");
    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });

  it("shows error when wallet not found", async () => {
    const user = userEvent.setup();
    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await user.click(screen.getByText("connect"));

    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent("No Midnight wallet extension found");
  });

  it("connects successfully with mock wallet", async () => {
    const mockApi = {
      getConfiguration: vi.fn().mockResolvedValue({
        indexerUri: "https://indexer.preprod.midnight.network/api/v4/graphql",
        indexerWsUri: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
        substrateNodeUri: "wss://rpc.preprod.midnight.network",
        networkId: "preprod",
      }),
      getShieldedAddresses: vi.fn().mockResolvedValue({
        shieldedAddress: "mn_shield_test1abc123",
        shieldedCoinPublicKey: "coinpub123",
        shieldedEncryptionPublicKey: "encpub123",
      }),
    };

    (window as unknown as Record<string, unknown>).midnight = {
      mnLace: {
        name: "Lace",
        apiVersion: "4.0.0",
        icon: "",
        rdns: "lace",
        connect: vi.fn().mockResolvedValue(mockApi),
      },
    };

    const user = userEvent.setup();
    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await user.click(screen.getByText("connect"));

    await vi.waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("connected");
    });

    expect(screen.getByTestId("address")).toHaveTextContent(
      "mn_shield_test1abc123",
    );
    expect(screen.getByTestId("wallet-name")).toHaveTextContent("Lace");
  });

  it("disconnects and clears state", async () => {
    const user = userEvent.setup();
    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    await user.click(screen.getByText("disconnect"));

    expect(screen.getByTestId("status")).toHaveTextContent("disconnected");
    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });
});
