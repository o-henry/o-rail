import type { ReactNode } from "react";
import { localeShortLabel, useI18n } from "../i18n";

type WorkspaceTab =
  | "workbench"
  | "dashboard"
  | "intelligence"
  | "workflow"
  | "tasks"
  | "feed"
  | "agents"
  | "handoff"
  | "knowledge"
  | "adaptation"
  | "bridge"
  | "settings";

type NavItem = {
  tab: WorkspaceTab;
  label: string;
  ariaLabel: string;
  title: string;
};

type AppNavProps = {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  renderIcon: (tab: WorkspaceTab, active: boolean) => ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  { tab: "tasks", label: "TASKS", ariaLabel: "TASKS", title: "TASKS" },
  { tab: "workflow", label: "nav.workflow.short", ariaLabel: "nav.workflow.title", title: "nav.workflow.title" },
  { tab: "knowledge", label: "nav.knowledge", ariaLabel: "nav.knowledge", title: "nav.knowledge" },
  { tab: "adaptation", label: "nav.adaptation", ariaLabel: "nav.adaptation", title: "nav.adaptation" },
  { tab: "settings", label: "nav.settings", ariaLabel: "nav.settings", title: "nav.settings" },
];
const SHOW_LANGUAGE_SWITCH = false;

export default function AppNav({ activeTab, onSelectTab, renderIcon }: AppNavProps) {
  const { locale, cycleLocale, t } = useI18n();
  return (
    <aside className="left-nav">
      <nav
        className="nav-list"
        style={{
          height: "100%",
          display: "grid",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.tab;
          const ariaLabel = item.ariaLabel.startsWith("nav.") ? t(item.ariaLabel) : item.ariaLabel;
          const title = item.title.startsWith("nav.") ? t(item.title) : item.title;
          const label = item.label.startsWith("nav.") ? t(item.label) : item.label;
          return (
            <button
              aria-label={ariaLabel}
              className={active ? "is-active" : ""}
              key={item.tab}
              onClick={() => onSelectTab(item.tab)}
              title={title}
              type="button"
            >
              <span className="nav-icon">{renderIcon(item.tab, active)}</span>
              <span className="nav-label">{label}</span>
            </button>
          );
        })}
      </nav>
      {SHOW_LANGUAGE_SWITCH && (
        <div className="nav-footer">
          <button
            aria-label={t("nav.language")}
            className="nav-lang-button"
            onClick={cycleLocale}
            title={`${t("nav.language")} · ${t(`lang.${locale}`)}`}
            type="button"
          >
            <span className="nav-lang-code">{localeShortLabel(locale)}</span>
          </button>
        </div>
      )}
    </aside>
  );
}
