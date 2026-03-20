import type { ReactNode } from "react";
import { localeShortLabel, useI18n } from "../i18n";

type WorkspaceTab =
  | "workbench"
  | "dashboard"
  | "intelligence"
  | "workflow"
  | "tasks"
  | "shell"
  | "feed"
  | "agents"
  | "handoff"
  | "knowledge"
  | "visualize"
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
  hidden?: boolean;
  onSelectTab: (tab: WorkspaceTab) => void;
  renderIcon: (tab: WorkspaceTab, active: boolean) => ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  { tab: "tasks", label: "nav.tasks", ariaLabel: "nav.tasks", title: "nav.tasks" },
  { tab: "shell", label: "nav.shell", ariaLabel: "nav.shell", title: "nav.shell" },
  { tab: "workflow", label: "nav.workflow.short", ariaLabel: "nav.workflow.title", title: "nav.workflow.title" },
  { tab: "knowledge", label: "nav.knowledge", ariaLabel: "nav.knowledge", title: "nav.knowledge" },
  { tab: "visualize", label: "nav.visualize", ariaLabel: "nav.visualize", title: "nav.visualize" },
  { tab: "adaptation", label: "nav.adaptation", ariaLabel: "nav.adaptation", title: "nav.adaptation" },
  { tab: "settings", label: "nav.settings", ariaLabel: "nav.settings", title: "nav.settings" },
];
const SHOW_LANGUAGE_SWITCH = false;

export default function AppNav({ activeTab, hidden = false, onSelectTab, renderIcon }: AppNavProps) {
  const { locale, cycleLocale, t } = useI18n();

  return (
    <aside aria-hidden={hidden} className={`left-nav${hidden ? " is-hidden" : ""}`}>
      <nav className="nav-list">
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.tab;
          const ariaLabel = item.ariaLabel.startsWith("nav.") ? t(item.ariaLabel) : item.ariaLabel;
          const title = item.title.startsWith("nav.") ? t(item.title) : item.title;
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
