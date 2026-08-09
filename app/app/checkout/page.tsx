import { CheckoutFlow } from "@/components/checkout/CheckoutFlow";
import { WalletProvider } from "@/components/WalletProvider";

export const metadata = { title: "Checkout — Kudira" };

/// The wallet provider is scoped to checkout, the only route that needs a
/// connected wallet. The cart total arrives as ?amount=<base units>; an absent
/// or unparseable value falls back to the demo default inside CheckoutFlow.
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ amount?: string }>;
}) {
  const { amount } = await searchParams;
  let parsed: bigint | undefined;
  try {
    parsed = amount ? BigInt(amount) : undefined;
  } catch {
    parsed = undefined;
  }
  return (
    <WalletProvider>
      <CheckoutFlow amount={parsed} />
    </WalletProvider>
  );
}
