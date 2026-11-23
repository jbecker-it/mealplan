import CookClient from "./CookClient";

export const metadata = { title: "Kochmodus · Mealplan" };

export default async function CookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { id } = await params;
  const { p } = await searchParams;
  return <CookClient id={Number(id)} initialPortions={Number(p) > 0 ? Number(p) : null} />;
}
