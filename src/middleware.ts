import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const token = req.cookies.get("procure_session")?.value;
  const path = req.nextUrl.pathname;
  const guarded = ["/dashboard", "/actions", "/vendors", "/history", "/reports", "/settings", "/portal"];
  if (!token && guarded.some((item) => path === item || path.startsWith(`${item}/`))) {
    const url = req.nextUrl.clone();
    url.pathname = path.startsWith("/portal") ? "/vendor/login" : "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/actions/:path*", "/vendors/:path*", "/history/:path*", "/reports/:path*", "/settings/:path*", "/portal/:path*"],
};
