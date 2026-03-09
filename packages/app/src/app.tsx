import "@/index.css"
import { File } from "@opencode-ai/ui/file"
import { I18nProvider } from "@opencode-ai/ui/context"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { Font } from "@opencode-ai/ui/font"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { MetaProvider } from "@solidjs/meta"
import { Navigate, Route, Router } from "@solidjs/router"
import { ErrorBoundary, type JSX, lazy, type ParentProps, Show, Suspense } from "solid-js"
import { AuthProvider, useAuth } from "@/context/auth"
import { CommandProvider } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { GlobalSyncProvider } from "@/context/global-sync"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { PromptProvider } from "@/context/prompt"
import { type ServerConnection, ServerProvider, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import DirectoryLayout from "@/pages/directory-layout"
import Layout from "@/pages/layout"
import { ErrorPage } from "./pages/error"

const Home = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const LoginPage = lazy(() => import("@/pages/login"))
const Loading = () => <div class="size-full" />

const HomeRoute = () => (
  <Suspense fallback={<Loading />}>
    <Home />
  </Suspense>
)

const SessionRoute = () => (
  <SessionProviders>
    <Suspense fallback={<Loading />}>
      <Session />
    </Suspense>
  </SessionProviders>
)

const SessionIndexRoute = () => <Navigate href="session" />
const LoginRoute = () => (
  <Suspense fallback={<Loading />}>
    <LoginPage />
  </Suspense>
)

function Protected(props: ParentProps) {
  const auth = useAuth()
  return <Show when={auth.loggedIn()} fallback={<Navigate href="/login" />}>{props.children}</Show>
}

function ProtectedApp(props: ParentProps) {
  return <Protected>{props.children}</Protected>
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.locale, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
      wsl?: boolean
    }
  }
}

function MarkedProviderWithNativeParser(props: ParentProps) {
  const platform = usePlatform()
  return <MarkedProvider nativeParser={platform.parseMarkdown}>{props.children}</MarkedProvider>
}

function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
              <CommandProvider>
                <HighlightsProvider>
                  <Layout>{props.children}</Layout>
                </HighlightsProvider>
              </CommandProvider>
            </ModelsProvider>
          </NotificationProvider>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <AppShellProviders>
      {props.appChildren}
      {props.children}
    </AppShellProviders>
  )
}

function RouterRootWithAuth(props: ParentProps<{ appChildren?: JSX.Element }>) {
  const auth = useAuth()
  return (
    <Show when={auth.loggedIn()} fallback={props.children}>
      <GlobalSDKProvider>
        <GlobalSyncProvider>
          <RouterRoot appChildren={props.appChildren}>{props.children}</RouterRoot>
        </GlobalSyncProvider>
      </GlobalSDKProvider>
    </Show>
  )
}

export function AppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <LanguageProvider>
          <UiI18nBridge>
            <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
              <DialogProvider>
                <MarkedProviderWithNativeParser>
                  <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                </MarkedProviderWithNativeParser>
              </DialogProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.key} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
}) {
  return (
    <ServerProvider defaultServer={props.defaultServer} servers={props.servers}>
      <AuthProvider>
        <ServerKey>
          <Router root={(routerProps) => <RouterRootWithAuth appChildren={props.children}>{routerProps.children}</RouterRootWithAuth>}>
            <Route path="/login" component={LoginRoute} />
            <Route
              path="/"
              component={(routeProps) => (
                <ProtectedApp>
                  <HomeRoute />
                  {routeProps.children}
                </ProtectedApp>
              )}
            />
            <Route
              path="/:dir"
              component={(routeProps) => (
                <ProtectedApp>
                  <DirectoryLayout>{routeProps.children}</DirectoryLayout>
                </ProtectedApp>
              )}
            >
              <Route path="/" component={SessionIndexRoute} />
              <Route path="/session/:id?" component={SessionRoute} />
            </Route>
          </Router>
        </ServerKey>
      </AuthProvider>
    </ServerProvider>
  )
}
