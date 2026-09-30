"use client";

import * as React from "react";
import { Badge, vendorOf } from "@/components/chat/ModelChip";

export type ModelTile = { id: string; title: string; model: string; note: string; auto?: boolean; vendor?: string };

/**
 * The usual models as a grid of cards — a logo, a plain name, the real model
 * underneath and one line on when to use it — for the studio default
 * (设置) and each AI employee's own model (训练). Text wraps; nothing is cut off.
 */
export function ModelTiles({ tiles, value, onPick, disabled = false }: { tiles: ModelTile[]; value: string | null; onPick: (id: string) => void; disabled?: boolean }) {
  return (
    <div className="mt-grid">
      {tiles.map((m) => {
        const on = value === m.id;
        return (
          <button key={m.id} type="button" disabled={disabled} aria-pressed={on} onClick={() => onPick(m.id)} className="mt-tile" data-on={on || undefined}>
            <span style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
              <Badge vendor={m.vendor ?? vendorOf(m.id)} size={32} auto={m.auto} />
              <span style={{ minWidth: 0, flexGrow: 1 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 650, color: "#171717", lineHeight: 1.35 }}>{m.title}</span>
                <span style={{ display: "block", fontSize: 11.5, color: "#8a8a86", lineHeight: 1.4, overflowWrap: "anywhere" }}>{m.model}</span>
              </span>
              <span className="mt-radio" aria-hidden>
                {on ? (
                  <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                ) : null}
              </span>
            </span>
            {m.note ? <span style={{ display: "block", fontSize: 12.5, color: "#5f5f5b", lineHeight: 1.5, marginTop: 8 }}>{m.note}</span> : null}
          </button>
        );
      })}
      <style>{MT_CSS}</style>
    </div>
  );
}

const MT_CSS = `
.mt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.mt-tile { display: flex; flex-direction: column; align-items: stretch; text-align: left; padding: 12px 12px 13px; border-radius: 12px; border: 1px solid #e7e6e2; background: #fff; font-family: inherit; cursor: pointer; min-width: 0; transition: border-color .12s ease, box-shadow .12s ease, background .12s ease; }
.mt-tile:hover:not(:disabled) { border-color: #cfcec8; box-shadow: 0 2px 8px rgba(0,0,0,.05); }
.mt-tile[data-on] { border-color: #1f5fbf; background: #f5f9ff; box-shadow: 0 0 0 3px rgba(31,95,191,.1); }
.mt-tile:disabled { cursor: default; }
.mt-radio { width: 18px; height: 18px; border-radius: 99px; border: 1.5px solid #cfcec8; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; margin-top: 2px; background: #fff; }
.mt-tile[data-on] .mt-radio { border-color: #1f5fbf; background: #1f5fbf; }
@media (max-width: 480px) { .mt-grid { grid-template-columns: 1fr; } }
`;
