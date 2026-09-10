import { ImageResponse } from "next/og";

/* Branded social card, generated at build time. Mirrors the hero band:
   teal-tinted dark canvas, hex logo mark, accent-teal keywords. */

export const alt = "Decenchro: deploy secure and auditable AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HEX = "polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%)";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#0e1a17",
          backgroundImage:
            "radial-gradient(900px 520px at 12% -10%, rgba(71, 200, 178, 0.26), transparent 68%), radial-gradient(760px 480px at 108% 118%, rgba(28, 69, 58, 0.6), transparent 70%)",
          color: "#f7f7f2",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 34,
              height: 34,
              background: "#f7f7f2",
              clipPath: HEX,
            }}
          />
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>
            decenchro
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 88,
            fontWeight: 500,
            lineHeight: 1.04,
            letterSpacing: -3,
          }}
        >
          <div style={{ display: "flex" }}>
            Deploy&nbsp;<span style={{ color: "#47c8b2" }}>secure</span>&nbsp;and
          </div>
          <div style={{ display: "flex" }}>
            <span style={{ color: "#47c8b2" }}>auditable</span>&nbsp;AI agents
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 26,
            color: "#93a29b",
          }}
        >
          <div style={{ display: "flex" }}>
            Your agent, on your server, on the record.
          </div>
          <div style={{ display: "flex", color: "#47c8b2" }}>decenchro.com</div>
        </div>
      </div>
    ),
    size,
  );
}
