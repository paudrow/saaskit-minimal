// Copyright 2023-2024 the Deno authors. All rights reserved. MIT license.
import type { State } from "@/plugins/session.ts";
import Head from "@/components/Head.tsx";
import { defineRoute } from "$fresh/server.ts";

export default defineRoute<State>((_req, ctx) => {
  const isSignedIn = ctx.state.sessionUser !== undefined;
  const isSubscribed = ctx.state.sessionUser?.isSubscribed ?? false;

  return (
    <>
      <Head href={ctx.url.href}>
      </Head>
      <main class="flex-1 p-4">
        <p>My main content</p>
          <p>
          {isSignedIn && isSubscribed && "Signed in and subscribed!"}
          {isSignedIn && !isSubscribed && "Signed in and not subscribed!"}
          {!isSignedIn && "Not signed in!"}
          </p>
      </main>
    </>
  );
});
