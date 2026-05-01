import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

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
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as Record<string, unknown>).role as string;
        token.org_id = (user as Record<string, unknown>).org_id as string;
        token.org_name = (user as Record<string, unknown>).org_name as string;
        token.access_token = (user as Record<string, unknown>).access_token as string;
        token.refresh_token = (user as Record<string, unknown>).refresh_token as string;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      session.user.org_id = token.org_id as string;
      session.user.org_name = token.org_name as string;
      session.user.access_token = token.access_token as string;
      return session;
    },
  },
  pages: { signIn: "/login" },
});
