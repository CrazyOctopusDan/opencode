import { Popover as Kobalte } from "@kobalte/core/popover"
import { Component, ComponentProps, createMemo, createResource, JSX, Show, ValidComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useLocal } from "@/context/local"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useProviders } from "@/hooks/use-providers"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tag } from "@opencode-ai/ui/tag"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"
import { useAuth } from "@/context/auth"
import { useSDK } from "@/context/sdk"
import { loadProvidersQuery } from "@/context/global-sync/bootstrap"
import { useQueryClient } from "@tanstack/solid-query"
import type { NormalizedProviderListResponse } from "@opencode-ai/ui/context"

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

type ModelState = ReturnType<typeof useLocal>["model"]

const ModelList: Component<{
  provider?: string
  class?: string
  onSelect: () => void
  action?: JSX.Element
  model?: ModelState
}> = (props) => {
  const model = props.model ?? useLocal().model
  const sdk = useSDK()
  const queryClient = useQueryClient()
  const language = useLanguage()
  const auth = useAuth()
  const navigate = useNavigate()
  const [providerData] = createResource(async () => {
    const buildModelResult = (input: NormalizedProviderListResponse) => {
      const enterprise = [...input.all.values()].filter((item) => item.id === "travelSky" || item.name === "travelSky")
      const allowed = new Set(enterprise.map((item) => item.id))
      const connected = new Set(input.connected.filter((id) => allowed.has(id)))
      return {
        ok: true as const,
        models: enterprise
          .filter((provider) => connected.has(provider.id))
          .flatMap((provider) =>
            Object.values(provider.models).map((model) => ({
              ...model,
              provider,
              name: model.name.replace("(latest)", "").trim(),
              latest: model.name.includes("(latest)"),
            })),
          ),
      }
    }
    const buildFailedResult = () => ({
      ok: false as const,
      models: [] as {
        id: string
        name: string
        latest: boolean
        provider: { id: string; name: string }
      }[],
    })
    try {
      const data = await queryClient.fetchQuery(
        loadProvidersQuery(sdk().scope, sdk().directory, sdk().client, {
          recoverProviderAuth: async () => {
            if (await auth.recover()) {
              return sdk().createClient({ directory: sdk().directory, throwOnError: true })
            }
            void auth.logout().then(() => navigate("/login"))
          },
        }),
      )
      return buildModelResult(data)
    } catch (error) {
      return buildFailedResult()
    }
  })

  const models = createMemo(() => {
    const list = providerData()
    if (!list?.ok) return []
    return list.models
      .filter((m) => model.visible({ modelID: m.id, providerID: m.provider.id }))
      .filter((m) => (props.provider ? m.provider.id === props.provider : true))
  })

  return (
    <div class="flex flex-col min-h-0 flex-1">
      <Show when={providerData.loading}>
        <div class="px-2 py-1 text-12-regular text-text-weak">Loading company model API...</div>
      </Show>
      <List
        class={`flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${props.class ?? ""}`}
        search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true, action: props.action }}
        emptyMessage={providerData.loading ? "Loading company models..." : language.t("dialog.model.empty")}
        key={(x) => `${x.provider.id}:${x.id}`}
        items={models}
        current={model.current()}
        filterKeys={["name", "id"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        itemWrapper={(item, node) => (
          <Tooltip
            class="w-full"
            placement="right-start"
            gutter={12}
            value={<ModelTooltip model={item} latest={item.latest} free={isFree(item.provider.id, item.cost)} />}
          >
            {node}
          </Tooltip>
        )}
        onSelect={(x) => {
          model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
            recent: true,
          })
          props.onSelect()
        }}
      >
        {(i) => (
          <div class="w-full flex items-center gap-x-2 text-13-regular">
            <span class="truncate">{i.name}</span>
            <Show when={isFree(i.provider.id, i.cost)}>
              <Tag>{language.t("model.tag.free")}</Tag>
            </Show>
            <Show when={i.latest}>
              <Tag>{language.t("model.tag.latest")}</Tag>
            </Show>
          </div>
        )}
      </List>
    </div>
  )
}

type ModelSelectorTriggerProps = Omit<ComponentProps<typeof Kobalte.Trigger>, "as" | "ref">
type Dismiss = "escape" | "outside" | "select" | "manage" | "provider"

export function ModelSelectorPopover(props: {
  provider?: string
  model?: ModelState
  children?: JSX.Element
  triggerAs?: ValidComponent
  triggerProps?: ModelSelectorTriggerProps
  onClose?: (cause: "escape" | "select") => void
}) {
  const [store, setStore] = createStore<{
    open: boolean
    dismiss: Dismiss | null
  }>({
    open: false,
    dismiss: null,
  })
  const dialog = useDialog()
  const providers = useProviders()

  const close = (dismiss: Dismiss) => {
    setStore("dismiss", dismiss)
    setStore("open", false)
  }

  const handleManage = () => {
    close("manage")
    void import("./dialog-manage-models").then((x) => {
      dialog.show(() => <x.DialogManageModels />)
    })
  }

  const handleConnectProvider = () => {
    if (!providers.canConnect()) return
    close("provider")
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }
  const language = useLanguage()

  return (
    <Kobalte
      open={store.open}
      onOpenChange={(next) => {
        if (next) setStore("dismiss", null)
        setStore("open", next)
      }}
      modal={false}
      placement="top-start"
      gutter={4}
    >
      <Kobalte.Trigger as={props.triggerAs ?? "div"} {...props.triggerProps}>
        {props.children}
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="w-72 h-80 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          onEscapeKeyDown={(event) => {
            close("escape")
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => close("outside")}
          onFocusOutside={() => close("outside")}
          onCloseAutoFocus={(event) => {
            const dismiss = store.dismiss
            if (dismiss === "outside") event.preventDefault()
            if (dismiss === "escape" || dismiss === "select") {
              event.preventDefault()
              props.onClose?.(dismiss)
            }
            setStore("dismiss", null)
          }}
        >
          <Kobalte.Title class="sr-only">{language.t("dialog.model.select.title")}</Kobalte.Title>
          <ModelList
            provider={props.provider}
            model={props.model}
            onSelect={() => close("select")}
            class="p-1"
            action={
              <div class="flex items-center gap-1">
                <Show when={providers.canConnect()}>
                  <Tooltip placement="top" value={language.t("command.provider.connect")}>
                    <IconButton
                      icon="plus-small"
                      variant="ghost"
                      iconSize="normal"
                      class="size-6"
                      aria-label={language.t("command.provider.connect")}
                      onClick={handleConnectProvider}
                    />
                  </Tooltip>
                </Show>
                <Tooltip placement="top" value={language.t("dialog.model.manage")}>
                  <IconButton
                    icon="sliders"
                    variant="ghost"
                    iconSize="normal"
                    class="size-6"
                    aria-label={language.t("dialog.model.manage")}
                    onClick={handleManage}
                  />
                </Tooltip>
              </div>
            }
          />
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

export const DialogSelectModel: Component<{ provider?: string; model?: ModelState }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const providers = useProviders()
  const auth = useAuth()
  const navigate = useNavigate()

  return (
    <Dialog
      title={language.t("dialog.model.select.title")}
      action={
        <Show when={providers.canConnect()}>
          <Button
            class="h-7 -my-1 text-14-medium"
            icon="plus-small"
            tabIndex={-1}
            onClick={() => {
              void import("./dialog-select-provider").then((x) => {
                dialog.show(() => <x.DialogSelectProvider />)
              })
            }}
          >
            {language.t("command.provider.connect")}
          </Button>
        </Show>
      }
    >
      <ModelList provider={props.provider} model={props.model} onSelect={() => dialog.close()} />
      <Button
        variant="ghost"
        class="ml-3 mt-5 mb-6 text-text-base self-start"
        onClick={() => {
          void import("./dialog-manage-models").then((x) => {
            dialog.show(() => <x.DialogManageModels />)
          })
        }}
      >
        {language.t("dialog.model.manage")}
      </Button>
      <Button
        variant="ghost"
        class="ml-3 -mt-3 mb-6 text-text-danger-base self-start"
        onClick={() => {
          void auth.logout().then(() => navigate("/login"))
        }}
      >
        退出登录
      </Button>
    </Dialog>
  )
}
