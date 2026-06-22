import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List, type ListRef } from "@opencode-ai/ui/list"
import { useNavigate } from "@solidjs/router"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createMemo, createResource, type Component, Show } from "solid-js"
import { useLocal } from "@/context/local"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogSelectProvider } from "./dialog-select-provider"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"
import { useAuth } from "@/context/auth"
import { useSDK } from "@/context/sdk"
import { loadProvidersQuery } from "@/context/global-sync/bootstrap"
import { useQueryClient } from "@tanstack/solid-query"
import type { NormalizedProviderListResponse } from "@opencode-ai/ui/context"

type ModelState = ReturnType<typeof useLocal>["model"]

export const DialogSelectModelUnpaid: Component<{ model?: ModelState }> = (props) => {
  const model = props.model ?? useLocal().model
  const sdk = useSDK()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const navigate = useNavigate()
  const providers = useProviders()
  const language = useLanguage()
  const auth = useAuth()
  const [providerData] = createResource(async () => {
    const started = Date.now()
    const buildModelResult = (input: NormalizedProviderListResponse) => {
      const data = input as NormalizedProviderListResponse & {
        debug_tempo?: unknown
      }
      const enterprise = [...data.all.values()].filter((item) => item.id === "travelSky" || item.name === "travelSky")
      const allowed = new Set(enterprise.map((item) => item.id))
      const connected = new Set(data.connected.filter((id) => allowed.has(id)))
      return {
        ok: true as const,
        latency: Date.now() - started,
        providers: enterprise.length,
        connected: [...connected].length,
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
        providerIDs: enterprise.map((item) => item.id),
        debug_tempo: data.debug_tempo,
      }
    }
    const buildFailedResult = (error?: string) => ({
      ok: false as const,
      latency: Date.now() - started,
      providers: 0,
      connected: 0,
      models: [] as {
        id: string
        name: string
        latest: boolean
        provider: { id: string; name: string }
      }[],
      providerIDs: [] as string[],
      error,
    })
    try {
      const data = await queryClient.fetchQuery(
        loadProvidersQuery(sdk.scope, sdk.directory, sdk.client, {
          recoverProviderAuth: async () => {
            if (await auth.recover()) {
              return sdk.createClient({ directory: sdk.directory, throwOnError: true })
            }
            void auth.logout().then(() => navigate("/login"))
          },
        }),
      )
      return buildModelResult(data)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return buildFailedResult(message)
    }
  })
  const models = createMemo(() => {
    const list = providerData()
    if (!list?.ok) return []
    return list.models
  })

  let listRef: ListRef | undefined
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  return (
    <Dialog
      title={language.t("dialog.model.select.title")}
      class="overflow-y-auto [&_[data-slot=dialog-body]]:overflow-visible [&_[data-slot=dialog-body]]:flex-none"
    >
      <div class="flex flex-col gap-3 px-2.5" onKeyDown={handleKeyDown}>
        <div class="text-14-medium text-text-base px-2.5">{language.t("dialog.model.unpaid.freeModels.title")}</div>
        <Show when={providerData.loading}>
          <div class="px-2 py-1 text-12-regular text-text-weak">Loading company model API...</div>
        </Show>
        <List
          class="px-3 [&_[data-slot=list-scroll]]:overflow-visible"
          ref={(ref) => (listRef = ref)}
          items={models}
          emptyMessage={providerData.loading ? "Loading company models..." : language.t("dialog.model.empty")}
          current={model.current()}
          key={(x) => `${x.provider.id}:${x.id}`}
          itemWrapper={(item, node) => (
            <Tooltip
              class="w-full"
              placement="right-start"
              gutter={12}
              value={
                <ModelTooltip
                  model={item}
                  latest={item.latest}
                  free={item.provider.id === "opencode" && (!item.cost || item.cost.input === 0)}
                />
              }
            >
              {node}
            </Tooltip>
          )}
          onSelect={(x) => {
            model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
              recent: true,
            })
            dialog.close()
          }}
        >
          {(i) => (
            <div class="w-full flex items-center gap-x-2.5">
              <span>{i.name}</span>
              <Show when={i.latest}>
                <Tag>{language.t("model.tag.latest")}</Tag>
              </Show>
            </div>
          )}
        </List>
        <Button
          variant="ghost"
          class="ml-2 mb-1 text-text-danger-base self-start"
          onClick={() => {
            void auth.logout().then(() => navigate("/login"))
          }}
        >
          退出登录
        </Button>
      </div>
      <Show when={providers.canConnect()}>
        <div class="px-1.5 pb-1.5">
          <div class="w-full rounded-sm border border-border-weak-base bg-surface-raised-base">
            <div class="w-full flex flex-col items-start gap-4 px-1.5 pt-4 pb-4">
              <div class="px-2 text-14-medium text-text-base">{language.t("dialog.model.unpaid.addMore.title")}</div>
              <div class="w-full">
                <List
                  class="w-full px-0"
                  key={(x) => x?.id}
                  items={providers.popular}
                  activeIcon="plus-small"
                  sortBy={(a, b) => {
                    if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
                      return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
                    return a.name.localeCompare(b.name)
                  }}
                  onSelect={(x) => {
                    if (!x) return
                    dialog.show(() => <DialogConnectProvider provider={x.id} />)
                  }}
                >
                  {(i) => (
                    <div class="w-full flex items-center gap-x-3">
                      <ProviderIcon data-slot="list-item-extra-icon" id={i.id} />
                      <span>{i.name}</span>
                      <Show when={i.id === "opencode"}>
                        <div class="text-14-regular text-text-weak">{language.t("dialog.provider.opencode.tagline")}</div>
                      </Show>
                      <Show when={i.id === "opencode"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                      <Show when={i.id === "opencode-go"}>
                        <>
                          <div class="text-14-regular text-text-weak">
                            {language.t("dialog.provider.opencodeGo.tagline")}
                          </div>
                          <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                        </>
                      </Show>
                      <Show when={i.id === "anthropic"}>
                        <div class="text-14-regular text-text-weak">{language.t("dialog.provider.anthropic.note")}</div>
                      </Show>
                    </div>
                  )}
                </List>
                <Button
                  variant="ghost"
                  class="w-full justify-start px-[11px] py-3.5 gap-4.5 text-14-medium"
                  icon="dot-grid"
                  onClick={() => {
                    dialog.show(() => <DialogSelectProvider />)
                  }}
                >
                  {language.t("dialog.provider.viewAll")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </Dialog>
  )
}
