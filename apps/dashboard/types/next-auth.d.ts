import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      org_id: string;
      org_name: string;
      access_token: string;
    } & DefaultSession["user"];
  }
}
