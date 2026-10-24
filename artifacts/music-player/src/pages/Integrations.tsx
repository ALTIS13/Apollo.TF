import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  Link2,
  Loader2,
  LockKeyhole,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { useTfAuth } from "@/auth/tf-auth";
import {
  spotifyLoginUrl,
  useSpotifyLogout,
  useSpotifyStatus,
} from "@/hooks/use-spotify";
import { useYandexLogout, useYandexStatus } from "@/hooks/use-yandex";

const control =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50";

function ServiceConnection({
  name,
  status,
  disconnect,
  loginUrl,
  color,
}: {
  name: string;
  status: UseQueryResult<{ connected: boolean; displayName?: string }, Error>;
  disconnect: UseMutationResult<unknown, Error, void>;
  loginUrl?: string;
  color: string;
}) {
  return (
    <section
      aria-label={name}
      className="flex flex-col gap-4 border-b border-white/10 py-6 sm:flex-row sm:items-start sm:gap-6"
    >
      <div className="flex min-w-0 items-center gap-3 sm:w-48 sm:shrink-0">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5"
          style={{ color }}
        >
          <Link2 className="h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold tracking-normal text-white">
          {name}
        </h2>
      </div>
      <div className="min-w-0 flex-1 text-sm">
        {status.isPending ? (
          <p
            role="status"
            className="flex items-center gap-2 text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
            Проверяем подключение...
          </p>
        ) : status.isError ? (
          <div>
            <p
              role="alert"
              className="mb-3 flex items-center gap-2 text-amber-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              Не удалось проверить подключение
            </p>
            <button
              className={control}
              disabled={status.isFetching}
              onClick={() => void status.refetch()}
              aria-label={`Проверить ${name} снова`}
            >
              <RefreshCw className="h-4 w-4" />
              Повторить
            </button>
          </div>
        ) : status.data.connected ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-1 text-emerald-400">Подключено</p>
              {status.data.displayName && (
                <p className="break-words text-muted-foreground">
                  {status.data.displayName}
                </p>
              )}
              <Link
                href="/favorites"
                className="mt-3 inline-flex items-center gap-1 text-white underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-white"
              >
                Коллекция
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <button
              className={control}
              aria-label={`Отключить ${name}`}
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              {disconnect.isPending ? (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Отключить
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground">Не подключено</p>
              {!loginUrl && (
                <p className="mt-2 text-amber-300">
                  Подключение временно недоступно
                </p>
              )}
            </div>
            {loginUrl && (
              <a
                href={loginUrl}
                className={control}
                aria-label={`Подключить ${name}`}
              >
                <Link2 className="h-4 w-4" />
                Подключить
              </a>
            )}
          </div>
        )}
        {disconnect.isError && (
          <p role="alert" className="mt-3 text-amber-300">
            Не удалось отключить сервис. Повторите попытку.
          </p>
        )}
      </div>
    </section>
  );
}

export default function Integrations() {
  const { hasEntitlement } = useTfAuth();
  const allowed = hasEntitlement("tf.integrations");
  const spotify = useSpotifyStatus(allowed);
  const yandex = useYandexStatus(allowed);
  const spotifyLogout = useSpotifyLogout();
  const yandexLogout = useYandexLogout();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [callback] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return query.has("spotify_error")
      ? "error"
      : query.get("spotify_connected") === "1"
        ? "returned"
        : null;
  });
  useEffect(() => {
    if (!callback) return;
    void queryClient.invalidateQueries({ queryKey: ["spotify", "status"] });
    navigate("/integrations", { replace: true });
  }, [callback, navigate, queryClient]);

  return (
    <div className="min-h-full bg-[#09090b] pb-8">
      <header className="border-b border-white/10">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
          <p className="mb-1 text-xs text-muted-foreground">Apollo TF</p>
          <h1 className="text-xl font-semibold tracking-normal text-white">
            Подключения
          </h1>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {!allowed ? (
          <div className="flex items-start gap-3 py-8 text-sm text-muted-foreground">
            <LockKeyhole className="h-5 w-5 shrink-0" />
            <div>
              <p>
                Подключение музыкальных сервисов недоступно для этого аккаунта.
              </p>
              <a
                href="https://apollot.ru/account"
                className="mt-3 inline-block text-white underline focus-visible:outline-2 focus-visible:outline-white"
              >
                Доступ аккаунта
              </a>
            </div>
          </div>
        ) : (
          <>
            {callback === "error" && (
              <p role="alert" className="pt-5 text-sm text-amber-300">
                Spotify не подтвердил подключение. Повторите попытку.
              </p>
            )}
            <ServiceConnection
              name="Spotify"
              status={spotify}
              disconnect={spotifyLogout}
              loginUrl={spotifyLoginUrl()}
              color="#1DB954"
            />
            <ServiceConnection
              name="Yandex Music"
              status={yandex}
              disconnect={yandexLogout}
              color="#FFCC00"
            />
          </>
        )}
      </div>
    </div>
  );
}
