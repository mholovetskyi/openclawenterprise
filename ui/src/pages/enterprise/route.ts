import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("enterprise"),
  component: () =>
    import("./enterprise-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-enterprise-page></openclaw-enterprise-page>`,
    })),
});
