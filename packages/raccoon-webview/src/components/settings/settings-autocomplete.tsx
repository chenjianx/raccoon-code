import { useLanguage } from "../../context/language"
import type { RaccoonAutocompleteModel } from "../../protocol"
import { Select, SettingsRow } from "./settings-common"

export function SettingsAutocomplete(props: {
  enabled: boolean
  model: string
  models: RaccoonAutocompleteModel[]
  onEnabledChange: (enabled: boolean) => void
  onModelChange: (model: string) => void
}) {
  const language = useLanguage()

  return (
    <>
      <h3>{language.t("settings.autocomplete.title")}</h3>
      <div className="settings-card settings-model-card">
        <SettingsRow
          title={language.t("settings.autocomplete.enable.title")}
          description={language.t("settings.autocomplete.enable.description")}
        >
          <input
            type="checkbox"
            role="switch"
            className="settings-toggle"
            checked={props.enabled}
            aria-label={language.t("settings.autocomplete.enable.title")}
            onChange={(event) => props.onEnabledChange(event.currentTarget.checked)}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.autocomplete.model.title")}
          description={language.t("settings.autocomplete.model.description")}
        >
          <Select
            className="settings-select w-[220px] max-w-full"
            value={props.model}
            options={props.models.map((model) => ({ value: model.id, label: model.label }))}
            ariaLabel={language.t("settings.autocomplete.model.title")}
            onChange={props.onModelChange}
          />
        </SettingsRow>
      </div>
    </>
  )
}
