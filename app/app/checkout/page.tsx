import { CheckoutFlow } from "@/components/checkout/CheckoutFlow";
import { WalletProvider } from "@/components/WalletProvider";

export const metadata = { title: "Checkout — Kudira" };

/// The wallet provider is scoped to checkout, the only route that needs a
/// connected wallet. Everything else reads the chain server-side.
export default function CheckoutPage() {
  return (
    <WalletProvider>
      <CheckoutFlow />
    </WalletProvider>
  );
}
