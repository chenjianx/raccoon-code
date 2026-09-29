import { TextareaRenderable, TextAttributes, type KeyEvent, type PasteEvent } from "@opentui/core" // raccoon_change - mask secret dialog input
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog, type DialogSize } from "./dialog"
import { Show, createEffect, createSignal, onMount, type JSX } from "solid-js"
import { Spinner } from "../component/spinner"
import { useConfig } from "../config"
import { useRenderer } from "@opentui/solid"

export type DialogPromptProps = {
  title: string
  size?: DialogSize
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  secret?: boolean // raccoon_change - keep password text out of the terminal editor
  busy?: boolean
  busyText?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export function DialogPrompt(props: DialogPromptProps) {
  const dialog = useDialog()
  const renderer = useRenderer()
  const theme = useTheme().surface("dialog")
  const shortcuts = Keymap.useShortcuts()
  const config = useConfig().data
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  let textarea: TextareaRenderable
  // raccoon_change start - store secret input separately so selection and render buffers contain masks only
  let secretValue = props.secret ? (props.value ?? "") : ""

  function mask(value: string) {
    secretValue = value
    textarea.setText("•".repeat([...value].length))
    textarea.gotoLineEnd()
  }

  function secretKey(event: KeyEvent) {
    if (!props.secret) return
    if (["return", "enter", "kpenter", "linefeed", "escape"].includes(event.name)) return
    event.preventDefault()
    if (event.name === "backspace") {
      mask([...secretValue].slice(0, -1).join(""))
      return
    }
    if (event.ctrl && event.name === "u") {
      mask("")
      return
    }
    if (event.ctrl || event.meta || event.option || event.super || event.hyper) return
    if (!event.sequence || /[\x00-\x1f\x7f]/.test(event.sequence)) return
    mask(secretValue + event.sequence)
  }

  function secretPaste(event: PasteEvent) {
    if (!props.secret) return
    event.preventDefault()
    mask(secretValue + new TextDecoder().decode(event.bytes).replace(/[\r\n]/g, ""))
  }
  // raccoon_change end

  function confirm() {
    if (props.busy) return
    props.onConfirm?.(props.secret ? secretValue : textarea.plainText) // raccoon_change - submit the private secret value
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    target: textareaTarget,
    enabled: textareaTarget() !== undefined && !props.busy,
    // Dialog form semantics must win over the global managed textarea input layer.
    priority: 1,
    commands: [
      {
        id: "dialog.prompt.submit",
        title: "Submit dialog prompt",
        group: "Dialog",
        run: confirm,
      },
    ],
  }))

  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: props.onCancel !== undefined,
    priority: 1,
    commands: [
      {
        bind: "escape",
        title: "Back",
        group: "Dialog",
        run: () => {
          if (renderer.getSelection()) {
            renderer.clearSelection()
            return
          }
          if (!props.busy) props.onCancel?.()
        },
      },
    ],
  }))

  onMount(() => {
    dialog.setSize(props.size ?? "medium")
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      if (props.busy) return
      textarea.focus()
    }, 1)
    textarea.gotoLineEnd()
  })

  createEffect(() => {
    if (!textarea || textarea.isDestroyed) return
    const traits = props.busy
      ? {
          suspend: true,
          status: "BUSY",
        }
      : {}
    textarea.traits = traits
    if (props.busy) {
      textarea.blur()
      return
    }
    textarea.focus()
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
          {props.title}
        </text>
        <text
          fg={theme.text.muted}
          onMouseUp={() => {
            if (!props.busy) (props.onCancel ?? dialog.clear)()
          }}
        >
          esc
        </text>
      </box>
      <box gap={1}>
        {props.description?.()}
        <textarea
          height={1}
          wrapMode="none"
          ref={(val: TextareaRenderable) => {
            textarea = val
            setTextareaTarget(val)
          }}
          initialValue={props.secret ? "•".repeat([...(props.value ?? "")].length) : props.value} // raccoon_change - never initialize editor with cleartext
          onKeyDown={secretKey} // raccoon_change - intercept edits before the native editor sees them
          onPaste={secretPaste} // raccoon_change - intercept pasted secrets before the native editor sees them
          placeholder={props.placeholder ?? "Enter text"}
          placeholderColor={theme.text.muted}
          textColor={props.busy ? theme.text.formfield.disabled : theme.text.formfield.base}
          focusedTextColor={props.busy ? theme.text.formfield.disabled : theme.text.formfield.base}
          cursorColor={props.busy ? theme.background.formfield.disabled : theme.text.base}
          cursorStyle={config.cursor}
        />
        <Show when={props.busy}>
          <Spinner color={theme.text.muted}>{props.busyText ?? "Working…"}</Spinner>
        </Show>
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <Show when={!props.busy} fallback={<text fg={theme.text.muted}>processing…</text>}>
          <Show when={shortcuts.get("dialog.prompt.submit")}>
            <text fg={theme.text.base}>
              {shortcuts.get("dialog.prompt.submit")} <span style={{ fg: theme.text.muted }}>submit</span>
            </text>
          </Show>
        </Show>
      </box>
    </box>
  )
}
