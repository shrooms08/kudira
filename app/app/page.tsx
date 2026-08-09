import { Storefront } from "@/components/store/Storefront";

export const metadata = { title: "Manila Coffee Roasters" };

/// Server wrapper: the cart itself is a client component (quantity state), and
/// its total is carried into checkout as ?amount=<base units>.
export default function StorefrontPage() {
  return <Storefront />;
}
