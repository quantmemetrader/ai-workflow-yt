import "server-only";
import "@/lib/keys/boot";

/**
 * Email out of the studio: invitations for now.
 *
 * Two ways, whichever is configured in .env.local:
 *   RESEND_API_KEY (+ EMAIL_FROM)  — Resend's HTTP API
 *   SMTP_URL (+ EMAIL_FROM)        — any mailbox, e.g.
 *                                    smtps://user%40tengya.media:app-password@smtp.exmail.qq.com:465
 * With neither, nothing is sent and the caller says so (the invite link is
 * still shown to copy).
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.SMTP_URL);
}

const FROM = () => process.env.EMAIL_FROM || "腾亚创变 <noreply@tengya.media>";

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (process.env.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM(), to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
      return { ok: true };
    }
    if (process.env.SMTP_URL) {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport(process.env.SMTP_URL);
      await transport.sendMail({ from: FROM(), to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
      return { ok: true };
    }
    return { ok: false, error: "no email service configured" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "send failed" };
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** The invitation email, Chinese first with English under it. */
export function inviteEmail(input: { to: string; inviter: string; link: string; expires: string }) {
  const subject = `${input.inviter} 邀请你加入腾亚创变 · Invitation to Tengya`;
  const text = [
    `${input.inviter} 邀请你加入腾亚创变的工作平台。`,
    `打开这个链接，填写姓名、设置密码就能登录：${input.link}`,
    `链接只能用一次，有效期至 ${input.expires}。`,
    "",
    `${input.inviter} invited you to Tengya's workspace. Open the link, set your name and password, and you are in: ${input.link}`,
    `It works once, until ${input.expires}.`,
  ].join("\n");
  const html = `<!doctype html><html lang="zh-Hans"><body style="margin:0;background:#f6f5f2;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#171717">
<div style="max-width:520px;margin:32px auto;background:#fff;border:1px solid #e7e6e2;border-radius:14px;padding:28px">
<div style="font-size:18px;font-weight:600;margin-bottom:12px">加入腾亚创变</div>
<p style="font-size:14px;line-height:1.7;margin:0 0 18px">${esc(input.inviter)} 邀请你加入腾亚创变的工作平台。点下面的按钮，填写姓名、设置密码就能登录。</p>
<a href="${esc(input.link)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px;font-weight:600">接受邀请 · Accept</a>
<p style="font-size:12px;color:#8a8a8a;line-height:1.6;margin:18px 0 0">链接只能用一次，有效期至 ${esc(input.expires)}。按钮打不开时，复制这个地址到浏览器：<br><span style="word-break:break-all">${esc(input.link)}</span></p>
<p style="font-size:12px;color:#a3a3a3;line-height:1.6;margin:14px 0 0">${esc(input.inviter)} invited you to Tengya's workspace. The link works once, until ${esc(input.expires)}.</p>
</div></body></html>`;
  return { subject, html, text };
}
