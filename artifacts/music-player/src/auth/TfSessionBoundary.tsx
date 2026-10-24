import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useTfAuth } from "./tf-auth";

function SessionState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <section className="w-full max-w-sm border border-white/10 bg-black/30 p-6 text-center">
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        <p className="mt-2 text-sm text-white/50">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </section>
    </main>
  );
}

function SessionLoading() {
  return (
    <SessionState
      title="Подключение к Apollo"
      description="Проверяем доступ к вашей сессии."
    />
  );
}

function SignInState({ onLogin }: { onLogin: () => void }) {
  return (
    <SessionState
      title="Требуется вход"
      description="Войдите через Apollo Platform, чтобы продолжить."
      action={<Button onClick={onLogin}>Войти</Button>}
    />
  );
}

function UnavailableState({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <SessionState
      title="Сервис временно недоступен"
      description="Не удалось проверить доступ. Повторите попытку позже."
      action={<Button onClick={() => void onRetry()}>Повторить</Button>}
    />
  );
}

function ModuleLockedState() {
  return (
    <SessionState
      title="Модуль недоступен"
      description="Ваша учетная запись не имеет доступа к музыкальному поиску."
    />
  );
}

export function TfSessionBoundary({ children }: { children: ReactNode }) {
  const { status, session, error, hasEntitlement, login, refresh, logout } =
    useTfAuth();

  if (status === "loading") return <SessionLoading />;
  if (status === "unauthenticated") return <SignInState onLogin={login} />;
  if (status === "unavailable" && error?.kind === "forbidden")
    return (
      <SessionState
        title="Модуль недоступен"
        description="Доступ не подтверждён текущими правами Apollo."
        action={<Button onClick={() => void logout()}>Выйти из TF</Button>}
      />
    );
  if (status === "unavailable" && !session)
    return <UnavailableState onRetry={refresh} />;
  if (status === "authenticated" && !hasEntitlement("tf.search"))
    return <ModuleLockedState />;

  return (
    <>
      {status === "unavailable" && <UnavailableState onRetry={refresh} />}
      <div
        key={`${session?.accountId}:${session?.installationId}:${session?.entitlements.slice().sort().join(",")}`}
        hidden={status !== "authenticated"}
        style={status === "authenticated" ? { display: "contents" } : undefined}
      >
        {children}
      </div>
    </>
  );
}
