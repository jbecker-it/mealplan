import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthed, isSetup } from "@/lib/auth";

export default async function Home() {
  const store = await cookies();
  if (!isSetup() || !isAuthed(store.get("mp")?.value)) redirect("/login");
  redirect("/plan");
}
