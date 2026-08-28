/**
 * Enterprise dashboard branding customization.
 *
 * The Enterprise settings page lets an admin override the brand title and
 * tagline shown in the Control UI chrome. Values are per-browser conveniences
 * persisted in localStorage (mirroring the pre-restructure UiSettings fields
 * enterpriseDashboardTitle / enterpriseDashboardTagline).
 */
import { getSafeLocalStorage } from "../../local-storage.ts";

const STORAGE_KEY = "openclaw.enterprise.branding";

export const DEFAULT_ENTERPRISE_BRAND_TITLE = "OpenClaw";
export const DEFAULT_ENTERPRISE_BRAND_TAGLINE = "Enterprise Gateway";

export type EnterpriseBranding = {
  title: string;
  tagline: string;
};

export function loadEnterpriseBranding(): EnterpriseBranding {
  const empty: EnterpriseBranding = { title: "", tagline: "" };
  try {
    const raw = getSafeLocalStorage()?.getItem(STORAGE_KEY);
    if (!raw) {
      return empty;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return empty;
    }
    return {
      title: "title" in parsed && typeof parsed.title === "string" ? parsed.title : "",
      tagline: "tagline" in parsed && typeof parsed.tagline === "string" ? parsed.tagline : "",
    };
  } catch {
    return empty;
  }
}

export function saveEnterpriseBranding(branding: EnterpriseBranding): void {
  try {
    const storage = getSafeLocalStorage();
    if (!storage) {
      return;
    }
    const title = branding.title.trim();
    const tagline = branding.tagline.trim();
    if (!title && !tagline) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify({ title, tagline }));
  } catch {
    // Persisting branding is best-effort; the in-memory value still applies.
  }
}

/** Brand title for the UI chrome: the admin override, or the default. */
export function enterpriseBrandTitle(): string {
  const custom = loadEnterpriseBranding().title.trim();
  return custom || DEFAULT_ENTERPRISE_BRAND_TITLE;
}
