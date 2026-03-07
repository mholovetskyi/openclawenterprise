import { html, nothing } from "lit";
import { t, type Locale } from "../../i18n/index.ts";
import type { UiSettings } from "../storage.ts";
import type { ThemeMode } from "../theme.ts";

export type OnboardingStep = 0 | 1 | 2 | 3 | 4;

export type OnboardingProps = {
  step: OnboardingStep;
  settings: UiSettings;
  connected: boolean;
  // Draft state during wizard
  draftOrgName: string;
  draftTagline: string;
  draftRole: string;
  draftGatewayUrl: string;
  draftToken: string;
  connectionTested: boolean;
  connectionSuccess: boolean | null;
  connectionTesting: boolean;
  // Callbacks
  onStepChange: (step: OnboardingStep) => void;
  onDraftOrgNameChange: (value: string) => void;
  onDraftTaglineChange: (value: string) => void;
  onDraftRoleChange: (value: string) => void;
  onDraftGatewayUrlChange: (value: string) => void;
  onDraftTokenChange: (value: string) => void;
  onTestConnection: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onFinish: () => void;
  onSkipConnect: () => void;
  basePath: string;
  theme: ThemeMode;
};

const STEPS: Array<{ key: string }> = [
  { key: "welcome" },
  { key: "setup" },
  { key: "connect" },
  { key: "preferences" },
  { key: "ready" },
];

const ROLES = ["admin", "developer", "analyst", "operator"] as const;

function roleIcon(role: string): string {
  switch (role) {
    case "admin":
      return "\u{1f6e1}\ufe0f";
    case "developer":
      return "\u{1f4bb}";
    case "analyst":
      return "\u{1f4ca}";
    case "operator":
      return "\u{2699}\ufe0f";
    default:
      return "\u{1f464}";
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case "admin":
      return t("onboarding.setup.roleAdmin");
    case "developer":
      return t("onboarding.setup.roleDeveloper");
    case "analyst":
      return t("onboarding.setup.roleAnalyst");
    case "operator":
      return t("onboarding.setup.roleOperator");
    default:
      return role;
  }
}

function roleDesc(role: string): string {
  switch (role) {
    case "admin":
      return t("onboarding.setup.roleAdminDesc");
    case "developer":
      return t("onboarding.setup.roleDeveloperDesc");
    case "analyst":
      return t("onboarding.setup.roleAnalystDesc");
    case "operator":
      return t("onboarding.setup.roleOperatorDesc");
    default:
      return "";
  }
}

function renderStepIndicator(current: OnboardingStep) {
  return html`
    <div class="ob-steps">
      ${STEPS.map(
        (s, i) => html`
          <div class="ob-step-dot ${i === current ? "ob-step-dot--active" : ""} ${i < current ? "ob-step-dot--done" : ""}">
            <span class="ob-step-dot__num">${i < current ? "\u2713" : i + 1}</span>
            <span class="ob-step-dot__label">${t(`onboarding.steps.${s.key}`)}</span>
          </div>
          ${i < STEPS.length - 1 ? html`<div class="ob-step-line ${i < current ? "ob-step-line--done" : ""}"></div>` : nothing}
        `,
      )}
    </div>
  `;
}

function renderWelcome(props: OnboardingProps) {
  const basePath = props.basePath;
  return html`
    <div class="ob-welcome">
      <div class="ob-welcome-logo">
        <img src=${basePath ? `${basePath}/favicon.svg` : "/favicon.svg"} alt="OpenClaw" class="ob-welcome-logo__img" />
      </div>
      <h1 class="ob-welcome-title">${t("onboarding.welcome.title")}</h1>
      <p class="ob-welcome-subtitle">${t("onboarding.welcome.subtitle")}</p>

      <div class="ob-features">
        <div class="ob-feature-card">
          <div class="ob-feature-icon">\u{1f916}</div>
          <div class="ob-feature-title">${t("onboarding.welcome.featureAgents")}</div>
          <div class="ob-feature-desc">${t("onboarding.welcome.featureAgentsDesc")}</div>
        </div>
        <div class="ob-feature-card">
          <div class="ob-feature-icon">\u{1f517}</div>
          <div class="ob-feature-title">${t("onboarding.welcome.featureChannels")}</div>
          <div class="ob-feature-desc">${t("onboarding.welcome.featureChannelsDesc")}</div>
        </div>
        <div class="ob-feature-card">
          <div class="ob-feature-icon">\u{1f512}</div>
          <div class="ob-feature-title">${t("onboarding.welcome.featureSecurity")}</div>
          <div class="ob-feature-desc">${t("onboarding.welcome.featureSecurityDesc")}</div>
        </div>
        <div class="ob-feature-card">
          <div class="ob-feature-icon">\u{1f4c8}</div>
          <div class="ob-feature-title">${t("onboarding.welcome.featureMonitoring")}</div>
          <div class="ob-feature-desc">${t("onboarding.welcome.featureMonitoringDesc")}</div>
        </div>
      </div>

      <button class="ob-btn ob-btn--primary ob-btn--lg" @click=${() => props.onStepChange(1)}>
        ${t("onboarding.welcome.getStarted")} \u2192
      </button>
    </div>
  `;
}

function renderSetup(props: OnboardingProps) {
  return html`
    <div class="ob-setup">
      <h2 class="ob-section-title">${t("onboarding.setup.title")}</h2>
      <p class="ob-section-subtitle">${t("onboarding.setup.subtitle")}</p>

      <div class="ob-form">
        <label class="ob-label">${t("onboarding.setup.orgName")}</label>
        <input
          class="ob-input"
          type="text"
          .value=${props.draftOrgName}
          placeholder=${t("onboarding.setup.orgNamePlaceholder")}
          @input=${(e: InputEvent) => props.onDraftOrgNameChange((e.target as HTMLInputElement).value)}
        />

        <label class="ob-label">${t("onboarding.setup.tagline")}</label>
        <input
          class="ob-input"
          type="text"
          .value=${props.draftTagline}
          placeholder=${t("onboarding.setup.taglinePlaceholder")}
          @input=${(e: InputEvent) => props.onDraftTaglineChange((e.target as HTMLInputElement).value)}
        />

        <label class="ob-label">${t("onboarding.setup.role")}</label>
        <div class="ob-role-grid">
          ${ROLES.map(
            (role) => html`
              <button
                class="ob-role-card ${props.draftRole === role ? "ob-role-card--selected" : ""}"
                @click=${() => props.onDraftRoleChange(role)}
              >
                <span class="ob-role-icon">${roleIcon(role)}</span>
                <span class="ob-role-label">${roleLabel(role)}</span>
                <span class="ob-role-desc">${roleDesc(role)}</span>
              </button>
            `,
          )}
        </div>
      </div>
    </div>
  `;
}

function renderConnect(props: OnboardingProps) {
  return html`
    <div class="ob-connect">
      <h2 class="ob-section-title">${t("onboarding.connect.title")}</h2>
      <p class="ob-section-subtitle">${t("onboarding.connect.subtitle")}</p>

      <div class="ob-form">
        <label class="ob-label">${t("onboarding.connect.gatewayUrl")}</label>
        <input
          class="ob-input"
          type="text"
          .value=${props.draftGatewayUrl}
          @input=${(e: InputEvent) => props.onDraftGatewayUrlChange((e.target as HTMLInputElement).value)}
        />

        <label class="ob-label">${t("onboarding.connect.token")}</label>
        <input
          class="ob-input"
          type="password"
          .value=${props.draftToken}
          placeholder=${t("onboarding.connect.tokenPlaceholder")}
          @input=${(e: InputEvent) => props.onDraftTokenChange((e.target as HTMLInputElement).value)}
        />

        <div class="ob-connect-actions">
          <button
            class="ob-btn ob-btn--primary"
            ?disabled=${props.connectionTesting}
            @click=${props.onTestConnection}
          >
            ${props.connectionTesting ? t("onboarding.connect.testing") : t("onboarding.connect.testConnection")}
          </button>
          ${props.connectionSuccess === true
            ? html`<span class="ob-connect-status ob-connect-status--ok">\u2713 ${t("onboarding.connect.success")}</span>`
            : nothing}
          ${props.connectionSuccess === false
            ? html`<span class="ob-connect-status ob-connect-status--fail">\u2717 ${t("onboarding.connect.failed")}</span>`
            : nothing}
        </div>

        <button class="ob-btn ob-btn--ghost" @click=${props.onSkipConnect}>
          ${t("onboarding.connect.skip")} \u2192
        </button>
      </div>
    </div>
  `;
}

function renderPreferences(props: OnboardingProps) {
  return html`
    <div class="ob-prefs">
      <h2 class="ob-section-title">${t("onboarding.preferences.title")}</h2>
      <p class="ob-section-subtitle">${t("onboarding.preferences.subtitle")}</p>

      <div class="ob-form">
        <label class="ob-label">${t("onboarding.preferences.theme")}</label>
        <div class="ob-theme-picker">
          ${(["light", "dark", "system"] as ThemeMode[]).map(
            (mode) => html`
              <button
                class="ob-theme-btn ${props.theme === mode ? "ob-theme-btn--active" : ""}"
                @click=${() => props.onThemeChange(mode)}
              >
                <span class="ob-theme-btn__icon">${mode === "light" ? "\u2600\ufe0f" : mode === "dark" ? "\u{1f319}" : "\u{1f4bb}"}</span>
                <span class="ob-theme-btn__label">${t(`onboarding.preferences.theme${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}</span>
              </button>
            `,
          )}
        </div>
      </div>
    </div>
  `;
}

function renderReady(props: OnboardingProps) {
  const orgName = props.draftOrgName.trim();
  const subtitle = orgName
    ? t("onboarding.ready.subtitle").replace("{org}", orgName)
    : t("onboarding.ready.subtitleGeneric");
  const role = props.draftRole || "admin";

  const tipKey = `onboarding.ready.tip${role.charAt(0).toUpperCase() + role.slice(1)}`;

  return html`
    <div class="ob-ready">
      <div class="ob-ready-check">\u2713</div>
      <h2 class="ob-ready-title">${t("onboarding.ready.title")}</h2>
      <p class="ob-ready-subtitle">${subtitle}</p>

      <div class="ob-ready-tip">
        <span class="ob-ready-tip__icon">${roleIcon(role)}</span>
        <span class="ob-ready-tip__text">${t(tipKey)}</span>
      </div>

      <div class="ob-ready-actions">
        <button class="ob-btn ob-btn--primary ob-btn--lg" @click=${props.onFinish}>
          ${t("onboarding.ready.openChat")} \u2192
        </button>
        <button class="ob-btn ob-btn--outline" @click=${() => props.onStepChange(1 as OnboardingStep)}>
          ${t("onboarding.ready.manageAgents")}
        </button>
      </div>
    </div>
  `;
}

export function renderOnboarding(props: OnboardingProps) {
  const step = props.step;
  const canGoBack = step > 0 && step < 4;
  const canGoNext = step > 0 && step < 4;
  const isWelcome = step === 0;
  const isReady = step === 4;

  return html`
    <div class="ob-container">
      ${!isWelcome ? renderStepIndicator(step) : nothing}

      <div class="ob-body">
        ${step === 0 ? renderWelcome(props) : nothing}
        ${step === 1 ? renderSetup(props) : nothing}
        ${step === 2 ? renderConnect(props) : nothing}
        ${step === 3 ? renderPreferences(props) : nothing}
        ${step === 4 ? renderReady(props) : nothing}
      </div>

      ${canGoBack || canGoNext
        ? html`
            <div class="ob-nav">
              ${canGoBack
                ? html`<button class="ob-btn ob-btn--outline" @click=${() => props.onStepChange((step - 1) as OnboardingStep)}>
                    \u2190 ${t("onboarding.nav.back")}
                  </button>`
                : html`<span></span>`}
              ${canGoNext
                ? html`<button class="ob-btn ob-btn--primary" @click=${() => props.onStepChange((step + 1) as OnboardingStep)}>
                    ${step === 3 ? t("onboarding.nav.finish") : t("onboarding.nav.next")} \u2192
                  </button>`
                : nothing}
            </div>
          `
        : nothing}
    </div>
  `;
}
