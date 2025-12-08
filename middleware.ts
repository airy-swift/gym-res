import { NextRequest, NextResponse } from "next/server";

const UNAUTHORIZED_PATH = "/unauthorized";
const PUBLIC_PATHS = new Set([UNAUTHORIZED_PATH]);

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const groupId = request.nextUrl.searchParams.get("gp");

  console.log("[middleware] incoming path", pathname, "gp", groupId);

  if (!groupId) {
    console.log("[middleware] missing gp query, redirecting");
    return redirectToUnauthorized(request);
  }

  try {
    const url = new URL("/api/groups", request.url);
    url.searchParams.set("groupId", groupId);

    const response = await fetch(url, { cache: "no-store" });

    console.log("[middleware] validation response", response.status);

    if (response.ok) {
      const { exists } = (await response.json()) as { exists?: boolean };
      console.log("[middleware] group exists?", exists);
      if (exists) {
        return NextResponse.next();
      }
    }

    if (response.status === 404) {
      return redirectToUnauthorized(request);
    }
  } catch (error) {
    console.error("[middleware] Failed to validate group access", error);
  }

  return redirectToUnauthorized(request);
}

function redirectToUnauthorized(request: NextRequest) {
  const unauthorizedUrl = request.nextUrl.clone();
  unauthorizedUrl.pathname = UNAUTHORIZED_PATH;
  unauthorizedUrl.search = "";

  return NextResponse.redirect(unauthorizedUrl);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
