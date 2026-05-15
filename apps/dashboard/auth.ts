import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

// Refresh the access_token 1 minute before the server's 15-minute expiry
const ACCESS_TOKEN_TTL_MS = 14 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/login`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: credentials.email,
                password: credentials.password,
              }),
            }
          );

          if (!res.ok) return null;

          const data = await res.json();
          return {
            id: data.user.id,
            email: data.user.email,
            role: data.user.role,
            org_id: data.user.org_id,
            org_name: data.user.org_name,
            access_token: data.access_token,
            refresh_token: data.refresh_token,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in — seed the token from the user object returned by authorize()
      if (user) {
        return {
          ...token,
          id: user.id,
          role: (user as Record<string, unknown>).role as string,
          org_id: (user as Record<string, unknown>).org_id as string,
          org_name: (user as Record<string, unknown>).org_name as string,
          access_token: (user as Record<string, unknown>).access_token as string,
          refresh_token: (user as Record<string, unknown>).refresh_token as string,
          access_token_expires_at: Date.now() + ACCESS_TOKEN_TTL_MS,
          error: undefined,
        };
      }

      // Access token still valid — nothing to do
      if (Date.now() < ((token.access_token_expires_at as number) ?? 0)) {
        return token;
      }

      // Access token expired — call the refresh endpoint
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/refresh`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: token.refresh_token }),
          }
        );

        if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);

        const data = await res.json();
        return {
          ...token,
          access_token: data.access_token,
          access_token_expires_at: Date.now() + ACCESS_TOKEN_TTL_MS,
          error: undefined,
        };
      } catch {
        // Refresh token is expired or invalid — signal the middleware to clear the session
        return { ...token, error: "RefreshTokenExpired" as const };
      }
    },

    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      session.user.org_id = token.org_id as string;
      session.user.org_name = token.org_name as string;
      session.user.access_token = token.access_token as string;
      session.error = token.error as string | undefined;
      return session;
    },
  },
  pages: { signIn: "/login" },
});
