import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/dal";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Aura Farmers" };

export default async function LoginPage() {
  if (await getViewer()) redirect("/chat");
  return <LoginForm />;
}
