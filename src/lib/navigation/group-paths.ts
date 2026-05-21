const AUTH_PATH = "/auth";
const FALLBACK_PATH = "/";

type BuildGroupPathOptions = {
  params?: Record<string, string | null | undefined>;
};

export function buildGroupPath(
  pathname: string,
  groupId: string,
  options: BuildGroupPathOptions = {},
): string {
  const query = new URLSearchParams({ gp: groupId });

  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value) {
      query.set(key, value);
    }
  }

  return `${pathname}?${query.toString()}`;
}

export function buildAuthPath(groupId: string, nextPath?: string | null): string {
  const query = new URLSearchParams({ gp: groupId });

  if (nextPath) {
    query.set("next", nextPath);
  }

  return `${AUTH_PATH}?${query.toString()}`;
}

export function resolveAuthNextPath(rawNext: string | undefined, groupId: string): string {
  return normalizeInternalPath(rawNext, buildGroupPath(FALLBACK_PATH, groupId), {
    disallowedPathnames: [AUTH_PATH],
  });
}

function normalizeInternalPath(
  rawPath: string | undefined,
  fallbackPath: string,
  options: { disallowedPathnames?: string[] } = {},
): string {
  const trimmedPath = rawPath?.trim() ?? "";
  if (!trimmedPath || !trimmedPath.startsWith("/") || trimmedPath.startsWith("//")) {
    return fallbackPath;
  }

  try {
    const parsedUrl = new URL(trimmedPath, "http://gym-reserver.local");
    if (parsedUrl.origin !== "http://gym-reserver.local") {
      return fallbackPath;
    }

    if (options.disallowedPathnames?.includes(parsedUrl.pathname)) {
      return fallbackPath;
    }

    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return fallbackPath;
  }
}
