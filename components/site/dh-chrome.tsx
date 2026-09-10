"use client";

import { useEffect, useState } from "react";

import { MARKETPLACE_HIDDEN } from "@/lib/marketplace/visibility";

import { LogoMark } from "./logo-mark";
import { useAuth } from "./use-auth";

// Nav and footer for the landing design system (.dh-* in app/home.css), shared
// by the home page and every (site) page so the chrome no longer changes shape
// as you move between them. Auth-aware, like the header it replaces: signed-in
// visitors get Dashboard and Log out instead of Log in.

// "#why" lives on the home page, so link to it absolutely from anywhere.
const WHY_HREF = "/#why";

export function DhNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { loading, email, signOut } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    ...(MARKETPLACE_HIDDEN
      ? []
      : [{ href: "/agents", label: "Agent marketplace" }]),
    { href: "/pricing", label: "Pricing" },
    { href: WHY_HREF, label: "Why decenchro" },
    ...(loading
      ? []
      : email
        ? [{ href: "/dashboard", label: "Dashboard" }]
        : [{ href: "/login", label: "Log in" }]),
  ];

  return (
    <nav className={`dh-nav${scrolled || menuOpen ? " dh-nav-scrolled" : ""}`}>
      <div className="dh-nav-inner">
        <a href="/" className="dh-logo">
          <LogoMark className="dh-logo-svg" />
          decenchro
        </a>
        <div className="dh-navlinks">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="dh-navlink">
              {l.label}
            </a>
          ))}
          {!loading && email && (
            <button
              type="button"
              className="dh-navlink dh-navlink-btn"
              onClick={() => signOut()}
            >
              Log out
            </button>
          )}
        </div>
        <button
          type="button"
          className="dh-menubtn"
          aria-expanded={menuOpen}
          aria-controls="dh-mobilemenu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>
      {menuOpen && (
        <div className="dh-mobilemenu" id="dh-mobilemenu">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="dh-mobilemenu-link"
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </a>
          ))}
          {!loading && email && (
            <button
              type="button"
              className="dh-mobilemenu-link dh-navlink-btn"
              onClick={() => {
                setMenuOpen(false);
                signOut();
              }}
            >
              Log out
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

export function DhFooter() {
  return (
    <footer className="dh-band-dark dh-footer">
      <div className="dh-wrap">
        <div className="dh-footer-grid">
          <div>
            <a href="/" className="dh-logo">
              <LogoMark className="dh-logo-svg" />
              decenchro
            </a>
          </div>
          <div>
            <div className="dh-footer-col-title">Product</div>
            {!MARKETPLACE_HIDDEN && (
              <a href="/agents" className="dh-footer-link">
                agent marketplace
              </a>
            )}
            <a href="/pricing" className="dh-footer-link">
              pricing
            </a>
            <a href={WHY_HREF} className="dh-footer-link">
              why decenchro
            </a>
          </div>
          <div>
            <div className="dh-footer-col-title">Account</div>
            <a href="/login" className="dh-footer-link">
              log in
            </a>
            <a href="/signup" className="dh-footer-link">
              sign up
            </a>
            <a href="/dashboard" className="dh-footer-link">
              dashboard
            </a>
          </div>
          <div>
            <div className="dh-footer-col-title">Built on</div>
            {[
              ["https://chromia.com", "chromia"],
              ["https://atbash.ai", "atbash"],
              ["https://nousresearch.com", "hermes"],
              ["https://openrouter.ai", "openrouter"],
            ].map(([href, label]) => (
              <a
                key={label}
                href={href}
                className="dh-footer-link"
                target="_blank"
                rel="noreferrer"
              >
                {label}
              </a>
            ))}
          </div>
        </div>
        <div className="dh-footer-base">
          <span>
            © {new Date().getFullYear()} decenchro · decentralised and auditable
            agents on Chromia
          </span>
          <button
            type="button"
            className="dh-totop"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            Back to top ↑
          </button>
        </div>
      </div>
    </footer>
  );
}
