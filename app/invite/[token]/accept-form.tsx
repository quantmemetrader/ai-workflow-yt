"use client";

import { useActionState } from "react";
import { acceptInviteAction, type AcceptState } from "./actions";

export function AcceptForm({ token, suggestedName }: { token: string; suggestedName: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInviteAction, {});

  return (
    <form action={action} style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 9 }}>
      <input type="hidden" name="token" value={token} />
      <input
        name="name"
        defaultValue={suggestedName}
        required
        maxLength={120}
        placeholder="The name you want to be known by"
        style={field}
      />
      <input
        name="password"
        type="password"
        required
        minLength={10}
        maxLength={1024}
        placeholder="A password, at least 10 characters"
        style={field}
      />
      {state.error && (
        <p style={{ fontSize: 12, color: "#e03636", margin: "2px 0 0", lineHeight: 1.5 }}>{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        style={{
          height: 36,
          marginTop: 5,
          borderRadius: 9,
          border: 0,
          background: "#171717",
          color: "#fff",
          fontSize: 13.5,
          fontWeight: 500,
          fontFamily: "inherit",
          letterSpacing: "inherit",
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.5 : 1,
        }}
      >
        {pending ? "Creating the account…" : "Join the studio"}
      </button>
    </form>
  );
}

const field: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  border: "1px solid #e2e2e2",
  borderRadius: 9,
  outline: "none",
  fontSize: 13.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  color: "#171717",
};
