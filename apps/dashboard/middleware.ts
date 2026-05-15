import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  const { pathname } = request.nextUrl;
  const isPublicPage = pathname.startsWith("/login") || pathname.startsWith("/register");

  // Refresh token expired — wipe the session cookie and send to login
  if (token?.error === "RefreshTokenExpired") {
    const response = NextResponse.redirect(new URL("/login", request.url));
    // Clear both the secure (production) and plain (dev) session cookies
    response.cookies.delete("next-auth.session-token");
    response.cookies.delete("__Secure-next-auth.session-token");
    return response;
  }

  // No session — redirect to login (unless already on a public page)
  if (!token && !isPublicPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Authenticated user hitting login/register — send to dashboard
  if (token && isPublicPage) {
    return NextResponse.redirect(new URL("/cases", request.url));
  }

  // Non-admin trying to access admin routes
  if (token && pathname.startsWith("/admin") && token.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/cases", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
