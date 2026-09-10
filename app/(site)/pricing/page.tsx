import { ContactButton } from "@/components/site/contact-modal";
import {
  PACKS,
  RUNTIME_CREDITS_PER_HOUR,
  SIGNUP_GRANT_CREDITS,
  creditsUsdLabel,
} from "@/lib/dashboard/credits";

export const metadata = { title: "Pricing · Decenchro" };

const DEPLOY_HREF = "/signup?next=/dashboard";

const ENTERPRISE = [
  "Many agents, no cap",
  "Credits on invoice",
  "Access to smarter models",
  "Priority support",
];

function Check() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="dh-plan-check"
      aria-hidden="true"
    >
      <path d="m4 10.5 3.5 3.5L16 5.5" />
    </svg>
  );
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="dh-plan-list">
      {items.map((f) => (
        <li key={f} className="dh-plan-item">
          <Check />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

// Runtime only. Model use draws on the same balance, so this is a ceiling on
// how long a pack lasts, never a promise. The page says so beside the number.
function days(credits: number): number {
  return Math.round(credits / RUNTIME_CREDITS_PER_HOUR / 24);
}

export default function PricingPage() {
  return (
    <main className="dh-band-dark dh-pricing">
      <div className="dh-wrap">
        <div className="dh-pricing-head">
          <h1 className="dh-display">Pay for what your agent runs.</h1>
          <p className="dh-lead">
            Buy credits, spend them while your agent is live. No subscription, no
            card, no renewal date. Your first {creditsUsdLabel(SIGNUP_GRANT_CREDITS)} of credit is on
            us.
          </p>
        </div>

        <div className="dh-plans dh-plans-three">
          {PACKS.map((pack) => (
            <div key={pack.id} className="dh-plan">
              <div className="dh-plan-head">
                <div className="dh-plan-name">{pack.label}</div>
                {pack.bonusPct > 0 && (
                  <span className="dh-plan-tag">+{pack.bonusPct}% extra</span>
                )}
              </div>
              <p className="dh-plan-blurb">
                ${pack.usd} for {creditsUsdLabel(pack.credits)} of credit, about{" "}
                {days(pack.credits)} days of runtime, plus what the model costs.
              </p>
              <FeatureList
                items={[
                  "Pay with CHR, USDC or USDT",
                  "Credits never expire",
                  "Model and AI access included",
                  "Every action on the record",
                ]}
              />
              <div className="dh-plan-cta">
                <a href={DEPLOY_HREF} className="dh-btn">
                  Deploy your agent
                  <span className="dh-arr" aria-hidden>
                    →
                  </span>
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="dh-plans dh-plans-second">
          <div className="dh-plan dh-plan-featured">
            <div className="dh-plan-head">
              <div className="dh-plan-name">Enterprise</div>
              <span className="dh-plan-tag">Most capable</span>
            </div>
            <p className="dh-plan-blurb">
              A managed fleet of smarter agents, with credits on invoice and
              support handled for you.
            </p>
            <FeatureList items={ENTERPRISE} />
            <div className="dh-plan-cta">
              <ContactButton
                label="Contact us"
                subject="Decenchro Enterprise enquiry"
                className="dh-btn-ghost"
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
