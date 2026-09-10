"use client";

import { MotionConfig } from "framer-motion";

/**
 * Makes every framer-motion animation in the app honor the OS
 * "reduce motion" setting. The CSS in globals.css already neutralizes
 * keyframe/transition animations under prefers-reduced-motion, but
 * framer-motion drives its animations in JS and needs this to opt in.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
