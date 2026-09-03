import type { AnnoteMcpState } from "./annote-mcp-client";
import { escapeHtml } from "./html-escape";
import type { FeedbackMarkSettings } from "./settings";
import { ANNOTE_VERSION } from "./version";

export type SettingsView = "root" | "mcp" | "help";
export type McpConnectionStatus = AnnoteMcpState;

export type SettingsViewData = {
  settings: FeedbackMarkSettings;
  mcpStatus: McpConnectionStatus;
  settingsView: SettingsView;
  mcpSetupCopyState: "idle" | "copied" | "failed";
  setupCommand: string;
  site: string;
  noticeHtml: string;
  shortcuts: { pick: string; copy: string; del: string };
};

export function mcpStatusLabel(status: McpConnectionStatus): string {
  if (status === "connected") return "Connected";
  if (status === "permission-required") return "Permission needed";
  if (status === "protocol-incompatible") return "Update required";
  if (status === "error") return "Error";
  return "Not connected";
}

export function mcpNeedsApprovalStatus(status: McpConnectionStatus): boolean {
  return status === "permission-required";
}

export function renderSettingsToggle(data: SettingsViewData, key: keyof FeedbackMarkSettings, label: string, help: string): string {
  const checked = data.settings[key];
  // NOTE: the row is a div, not a button — a button row cannot contain the
  // help-tip button (nested buttons are invalid HTML and browsers shred them).
  return `<div class="settings-row" aria-checked="${checked ? "true" : "false"}" data-action="toggle-setting" data-setting="${key}">
      <span class="settings-row-label">
        <strong>${escapeHtml(label)}</strong>
        <button type="button" class="settings-help-tip" aria-label="${escapeHtml(help)}" data-tooltip="${escapeHtml(help)}">?</button>
      </span>
      <button class="settings-switch" type="button" role="switch" aria-checked="${checked ? "true" : "false"}" aria-label="${escapeHtml(label)}" data-action="toggle-setting" data-setting="${key}"><span class="settings-toggle" aria-hidden="true"></span></button>
    </div>`;
}

export function renderSettingsRoot(data: SettingsViewData): string {
  return `
      <div class="panel-head">
        <div class="panel-title">
          <h2>Settings</h2>
        </div>
        <span class="settings-version">v${ANNOTE_VERSION}</span>
      </div>
      <div class="settings-list">
        <section class="settings-section" aria-label="Behavior">
          ${renderSettingsToggle(data, "pauseAnimationOnSelect", "Pause animation on select", "Pause active motion when you select it.")}
          ${renderSettingsToggle(data, "clearAfterSend", "Clear after send", "Remove submitted annotations after sending.")}
          ${renderSettingsToggle(data, "preventPageActions", "Prevent page interactions while annotating", "Prevent clicks and hover interactions while selecting elements.")}
          ${renderSettingsToggle(data, "continuousDictation", "Keep listening", "Keep the microphone open through pauses instead of stopping at the first silence.")}
        </section>
        <section class="settings-section" aria-label="Context">
          ${renderSettingsToggle(data, "reactContext", "React context", "Include component and source context when available.")}
        </section>
        <section class="settings-section" aria-label="Connections">
          <div class="settings-row" role="button" tabindex="0" data-action="settings-view" data-settings-view="mcp" aria-label="MCP, ${escapeHtml(mcpStatusLabel(data.mcpStatus))}">
            <span class="settings-row-label">
              <strong>MCP</strong>
              <button type="button" class="settings-help-tip" aria-label="Connect MCP to your coding agent." data-tooltip="Connect MCP to your coding agent.">?</button>
            </span>
            <span class="settings-row-meta">${mcpNeedsApprovalStatus(data.mcpStatus) ? `<span class="settings-approval-dot" aria-hidden="true"></span>` : ""}<span>${escapeHtml(mcpStatusLabel(data.mcpStatus))}</span><span class="settings-chevron" aria-hidden="true">&rsaquo;</span></span>
          </div>
        </section>
        <section class="settings-section" aria-label="Help">
          <div class="settings-row" role="button" tabindex="0" data-action="settings-view" data-settings-view="help" aria-label="How to use">
            <span class="settings-row-label"><strong>How to use</strong></span>
            <span class="settings-row-meta"><span class="settings-chevron" aria-hidden="true">&rsaquo;</span></span>
          </div>
        </section>
      </div>
      ${data.noticeHtml}
    `;
}

export function renderSettingsHeader(title: string): string {
  return `<div class="panel-head detail">
      <button class="settings-back" type="button" data-action="settings-view" data-settings-view="root" aria-label="Back">&lsaquo;</button>
      <div class="panel-title"><h2>${escapeHtml(title)}</h2></div>
    </div>`;
}

export function renderMcpSettings(data: SettingsViewData): string {
  if (data.mcpStatus === "permission-required") {
    return `
        ${renderSettingsHeader("MCP")}
        <div class="settings-detail">
          <h3 class="settings-state-title approval"><span class="settings-live-dot" aria-hidden="true"></span>Permission needed</h3>
          <p class="settings-copy">Allow Annote on</p>
          <div class="settings-command"><code>${escapeHtml(data.site)}</code></div>
          <button class="text-btn compact primary" type="button" data-action="settings-mcp-allow">Allow on this site</button>
          <p class="settings-copy">You only need to do this once.</p>
        </div>
        ${data.noticeHtml}
      `;
  }
  if (data.mcpStatus === "connected") {
    return `
        ${renderSettingsHeader("MCP")}
        <div class="settings-detail">
          <h3 class="settings-state-title"><span class="settings-live-dot" aria-hidden="true"></span>Connected</h3>
          <p class="settings-copy">Annote is ready to share feedback with your coding agent.</p>
          <div class="settings-kv">
            <div class="settings-kv-row"><span>Site</span><strong>${escapeHtml(data.site)}</strong></div>
          </div>
          <button class="settings-link-button" type="button" data-action="settings-mcp-revoke">Revoke this site</button>
        </div>
        ${data.noticeHtml}
      `;
  }
  if (data.mcpStatus === "protocol-incompatible") {
    return `
        ${renderSettingsHeader("MCP")}
        <div class="settings-detail">
          <h3 class="settings-state-title">Update required</h3>
          <p class="settings-copy">Your Annote browser and MCP companion use different versions.</p>
          <div class="settings-command"><code>npm run mcp:build</code><button type="button" data-action="settings-copy-command">${data.mcpSetupCopyState === "copied" ? "Copied" : "Copy"}</button></div>
        </div>
        ${data.noticeHtml}
      `;
  }
  if (data.mcpStatus === "error") {
    return `
        ${renderSettingsHeader("MCP")}
        <div class="settings-detail">
          <h3 class="settings-state-title">Something's not connecting.</h3>
          <button class="text-btn compact" type="button" data-action="settings-copy-doctor">Run diagnostics</button>
        </div>
        ${data.noticeHtml}
      `;
  }
  return `
      ${renderSettingsHeader("MCP")}
      <div class="settings-detail">
        <p class="settings-copy">Connect MCP to your coding agent.</p>
        <h3 class="settings-state-title">Not connected</h3>
        <p class="settings-copy">Run once</p>
        <div class="settings-command"><code>${escapeHtml(data.setupCommand)}</code><button type="button" data-action="settings-copy-command">${data.mcpSetupCopyState === "copied" ? "Copied" : "Copy"}</button></div>
        <p class="settings-copy">Then restart your coding agent.</p>
      </div>
      ${data.noticeHtml}
    `;
}

export function renderHelpSettings(data: SettingsViewData): string {
  const rows: Array<[string, string]> = [
    ["Select element", "Click"],
    ["Multi-select / add-remove", "Shift + click"],
    ["Move toolbar", "Hold + drag"],
    ["Pick element", data.shortcuts.pick],
    ["Copy unresolved", data.shortcuts.copy],
    ["Delete", `${data.shortcuts.del} + confirm`],
    ["Stop selecting", "Esc"],
    ["Submit", "Enter"],
    ["New line", "Shift + Enter"],
    ["Cancel", "Esc"],
    ["Scrub animation", "Drag timeline"],
    ["Replay animation", "Replay button"],
    ["Coding agent", "Settings -> MCP"],
  ];
  if (data.settings.pauseAnimationOnSelect) rows.splice(8, 0, ["Inspect animation", "Select animated element"]);
  return `
      ${renderSettingsHeader("How to use")}
      <div class="settings-detail">
        <div class="settings-kv">
          ${rows.map(([label, value]) => `<div class="settings-kv-row"><span>${escapeHtml(label)}</span><span class="settings-kbd">${escapeHtml(value)}</span></div>`).join("")}
        </div>
      </div>
    `;
}

export function renderSettingsPageContent(data: SettingsViewData): string {
  if (data.settingsView === "mcp") return renderMcpSettings(data);
  if (data.settingsView === "help") return renderHelpSettings(data);
  return renderSettingsRoot(data);
}

export function renderSettingsContent(data: SettingsViewData): string {
  return `<div class="settings-viewport" data-settings-viewport>
      <div class="settings-page" data-settings-page data-settings-view="${data.settingsView}">
        ${renderSettingsPageContent(data)}
      </div>
    </div>`;
}
