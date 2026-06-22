import { Component, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useProviders } from "@/hooks/use-providers"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { useLanguage } from "@/context/language"

export const DialogSelectProvider: Component = () => {
  const dialog = useDialog()
  const providers = useProviders()
  const language = useLanguage()
  const items = () => {
    const all = providers.all()
    const enterprise = all.filter((item) => item.id === "travelSky" || item.name === "travelSky")
    if (enterprise.length > 0) return enterprise
    return all
  }

  return (
    <Dialog title={language.t("command.provider.connect")} transition>
      <List
        class="px-3"
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(x) => x?.id}
        items={items}
        filterKeys={["id", "name"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={(x) => {
          if (!x) return
          dialog.show(() => <DialogConnectProvider provider={x.id} />)
        }}
      >
        {(i) => (
          <div class="px-1.25 w-full flex items-center gap-x-3">
            <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
            <span>{i.name}</span>
            <Show when={i.id === "opencode"}>
              <div class="text-14-regular text-text-weak">{language.t("dialog.provider.opencode.tagline")}</div>
            </Show>
            <Show when={i.id === "opencode"}>
              <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
