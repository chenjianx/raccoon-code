import { memo, useEffect, useState } from "react"
import {
  Cloud,
  FileText,
  MagicWand,
  Plugs,
  Robot,
  Scroll,
  SlidersHorizontal,
  TerminalWindow,
  Translate,
} from "@phosphor-icons/react"
import { useLanguage } from "../../context/language"
import { useSessionActions, useSessionConfig } from "../../context/session"
import { SettingsActions } from "./settings-actions"
import { SettingsAgents } from "./settings-agents"
import { SettingsAutocomplete } from "./settings-autocomplete"
import { SettingsCommands } from "./settings-commands"
import { Select } from "./settings-common"
import { SettingsRules } from "./settings-rules"
import { SettingsLanguage } from "./settings-language"
import { SettingsMcp } from "./settings-mcp"
import { SettingsModels } from "./settings-models"
import { SettingsProviders } from "./settings-providers"
import { SettingsSkills } from "./settings-skills"

type ModelSelection = { providerID: string; modelID: string }

function sameModel(a: ModelSelection | undefined, b: ModelSelection | undefined) {
  return a?.providerID === b?.providerID && a?.modelID === b?.modelID
}

export const SettingsView = memo(function SettingsView(props: { onClose?: () => void }) {
  const language = useLanguage()
  const config = useSessionConfig()
  const actions = useSessionActions()
  const [tab, setTab] = useState<
    "models" | "agents" | "commands" | "rules" | "providers" | "mcp" | "skills" | "language" | "autocomplete"
  >("providers")
  const tabs = [
    { value: "providers", label: language.t("settings.nav.providers"), icon: Cloud },
    { value: "models", label: language.t("settings.nav.models"), icon: SlidersHorizontal },
    { value: "agents", label: language.t("settings.nav.agents"), icon: Robot },
    { value: "mcp", label: language.t("settings.nav.mcp"), icon: Plugs },
    { value: "skills", label: language.t("settings.nav.skills"), icon: FileText },
    { value: "commands", label: language.t("settings.nav.commands"), icon: TerminalWindow },
    { value: "rules", label: language.t("settings.nav.rules"), icon: Scroll },
    { value: "language", label: language.t("settings.nav.language"), icon: Translate },
    { value: "autocomplete", label: language.t("settings.nav.autocomplete"), icon: MagicWand },
  ] as const
  const [draftPluginLanguageMode, setDraftPluginLanguageMode] = useState(config.pluginLanguageMode ?? "auto")
  const [draftSelectedModel, setDraftSelectedModel] = useState<ModelSelection | undefined>(config.defaultModel)
  const [draftModeModels, setDraftModeModels] = useState<Partial<Record<string, ModelSelection>>>(
    config.modeModels ?? {},
  )
  const configuredAutocompleteModel =
    config.autocompleteModel ?? config.autocompleteModels?.[0]?.id ?? "raccoon-pro-completion"
  const [draftAutocompleteEnabled, setDraftAutocompleteEnabled] = useState(config.autocompleteEnabled ?? true)
  const [draftAutocompleteModel, setDraftAutocompleteModel] = useState(configuredAutocompleteModel)
  const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "error" | "success"; error?: string }>({
    status: "idle",
  })

  useEffect(() => {
    if (saveState.status === "saving" || saveState.status === "error") return
    setDraftSelectedModel(config.defaultModel)
    setDraftModeModels(config.modeModels ?? {})
    setDraftPluginLanguageMode(config.pluginLanguageMode ?? "auto")
    setDraftAutocompleteEnabled(config.autocompleteEnabled ?? true)
    setDraftAutocompleteModel(configuredAutocompleteModel)
  }, [
    config.autocompleteEnabled,
    config.defaultModel,
    config.modeModels,
    config.pluginLanguageMode,
    configuredAutocompleteModel,
    saveState.status,
  ])

  useEffect(() => {
    if (saveState.status !== "success") return
    const timeout = window.setTimeout(() => setSaveState({ status: "idle" }), 2000)
    return () => window.clearTimeout(timeout)
  }, [saveState.status])

  const connectedModels = config.models.filter((model) => model.connected)
  const modeAgents = config.agents.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  const modes = modeAgents.map((agent) => agent.name)
  const dirty =
    !sameModel(draftSelectedModel, config.defaultModel) ||
    modes.some((mode) => !sameModel(draftModeModels[mode], config.modeModels?.[mode])) ||
    draftPluginLanguageMode !== (config.pluginLanguageMode ?? "auto") ||
    draftAutocompleteEnabled !== (config.autocompleteEnabled ?? true) ||
    draftAutocompleteModel !== configuredAutocompleteModel

  const discard = () => {
    setDraftSelectedModel(config.defaultModel)
    setDraftModeModels(config.modeModels ?? {})
    setDraftPluginLanguageMode(config.pluginLanguageMode ?? "auto")
    setDraftAutocompleteEnabled(config.autocompleteEnabled ?? true)
    setDraftAutocompleteModel(configuredAutocompleteModel)
    setSaveState({ status: "idle" })
  }

  const save = async () => {
    if (saveState.status === "saving") return
    setSaveState({ status: "saving" })
    const changedModes = modes.filter((mode) => !sameModel(draftModeModels[mode], config.modeModels?.[mode]))
    const result = await actions.saveSettings({
      ...(!sameModel(draftSelectedModel, config.defaultModel) && draftSelectedModel
        ? { defaultModel: draftSelectedModel }
        : {}),
      ...(changedModes.length
        ? { modeModels: Object.fromEntries(changedModes.map((mode) => [mode, draftModeModels[mode]])) }
        : {}),
      ...(draftPluginLanguageMode !== (config.pluginLanguageMode ?? "auto")
        ? { pluginLanguageMode: draftPluginLanguageMode }
        : {}),
      ...(draftAutocompleteEnabled !== (config.autocompleteEnabled ?? true)
        ? { autocompleteEnabled: draftAutocompleteEnabled }
        : {}),
      ...(draftAutocompleteModel !== configuredAutocompleteModel
        ? { autocompleteModel: draftAutocompleteModel }
        : {}),
    })
    setSaveState(result.success ? { status: "success" } : { status: "error", error: result.error })
  }

  return (
    <section className="settings-view">
      {props.onClose ? (
        <div className="settings-header">
          <div>
            <div className="settings-title">{language.t("settings.title")}</div>
          </div>
          <button
            type="button"
            className="min-h-[28px] shrink-0 rounded-[6px] border border-transparent bg-[var(--color-button)] px-[10px] text-[var(--color-foreground)] hover:bg-[var(--color-hover)]"
            onClick={props.onClose}
            aria-label={language.t("common.back")}
          >
            {language.t("common.back")}
          </button>
        </div>
      ) : null}

      <div className="settings-shell">
        <nav className="settings-nav" aria-label={language.t("settings.nav.label")}>
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`settings-nav-item ${tab === item.value ? "active" : ""}`}
              onClick={() => setTab(item.value)}
              title={item.label}
              aria-current={tab === item.value ? "page" : undefined}
            >
              <span className="settings-nav-icon">
                <item.icon size={16} weight="bold" />
              </span>
              <span className="settings-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-mobile-nav">
          <Select
            value={tab}
            options={tabs.map((item) => ({ value: item.value, label: item.label }))}
            ariaLabel={language.t("settings.nav.label")}
            onChange={(value) => {
              const selected = tabs.find((item) => item.value === value)
              if (selected) setTab(selected.value)
            }}
          />
        </div>

        <div className="settings-content">
          <div
            className={`settings-content-inner ${tab === "rules" || tab === "commands" || tab === "mcp" || tab === "skills" || tab === "agents" ? "h-full" : "min-h-full"}${tab === "rules" ? " settings-content-inner-rules" : tab === "agents" ? " settings-content-inner-agents" : ""}`}
          >
            {tab === "models" ? (
              <SettingsModels
                agents={modeAgents}
                connectedModels={connectedModels}
                selectedModel={draftSelectedModel}
                modeModels={draftModeModels}
                onSelectedModelChange={setDraftSelectedModel}
                onModeModelChange={(mode, model) => setDraftModeModels((current) => ({ ...current, [mode]: model }))}
                onModeModelClear={(mode) => setDraftModeModels((current) => ({ ...current, [mode]: undefined }))}
              />
            ) : tab === "agents" ? (
              <SettingsAgents
                agents={config.agents}
                connectedModels={connectedModels}
                onConfigureAgent={actions.configureAgent}
                onDeleteAgent={actions.deleteAgent}
              />
            ) : tab === "commands" ? (
              <SettingsCommands
                commandConfigs={config.commandConfigs ?? []}
                availableCommands={config.commands ?? []}
                agents={config.agents}
                connectedModels={connectedModels}
                onSaveCommand={actions.saveCommand}
                onDeleteCommand={actions.deleteCommand}
              />
            ) : tab === "language" ? (
              <SettingsLanguage
                pluginLanguageMode={draftPluginLanguageMode}
                onPluginLanguageChange={setDraftPluginLanguageMode}
              />
            ) : tab === "autocomplete" ? (
              <SettingsAutocomplete
                enabled={draftAutocompleteEnabled}
                model={draftAutocompleteModel}
                models={config.autocompleteModels ?? []}
                onEnabledChange={setDraftAutocompleteEnabled}
                onModelChange={setDraftAutocompleteModel}
              />
            ) : tab === "rules" ? (
              <SettingsRules
                rules={config.rules ?? []}
                onSaveRule={actions.saveRule}
                onToggleRule={actions.toggleRule}
                onDeleteRule={actions.deleteRule}
              />
            ) : tab === "mcp" ? (
              <SettingsMcp />
            ) : tab === "skills" ? (
              <SettingsSkills />
            ) : (
              <SettingsProviders />
            )}
          </div>
        </div>
      </div>

      {dirty || saveState.status !== "idle" ? (
        <SettingsActions
          status={saveState.status === "idle" || (dirty && saveState.status === "success") ? "dirty" : saveState.status}
          error={saveState.error}
          onDiscard={discard}
          onSave={save}
        />
      ) : null}
    </section>
  )
})
