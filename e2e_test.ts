// Copyright 2023-2024 the Deno authors. All rights reserved. MIT license.

import { createHandler } from "$fresh/server.ts";
import manifest from "@/fresh.gen.ts";
import {
  collectValues,
  createUser,
  getUser,
  randomUser,
  User,
} from "@/utils/db.ts";
import { stripe } from "@/utils/stripe.ts";
import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertInstanceOf,
  assertNotEquals,
  assertObjectMatch,
  assertStringIncludes,
} from "std/assert/mod.ts";
import { isRedirectStatus, STATUS_CODE } from "std/http/status.ts";
import { resolvesNext, returnsNext, stub } from "std/testing/mock.ts";
import Stripe from "stripe";
import options from "./fresh.config.ts";
import { _internals } from "./plugins/kv_oauth.ts";

/**
 * These tests are end-to-end tests, which follow this rule-set:
 * 1. `Response.status` is checked first by using the `Status` enum. It's the
 * primary indicator of whether the request was successful or not.
 * 2. `Response.header`'s `content-type` is checked next to ensure the
 * response is of the expected type. This is where custom assertions are used.
 * 3. `Response.body` is checked last, if needed. This is where the actual
 * content of the response is checked. Here, we're checking if the body is
 * instance of a specific type, equals a specific string, contains a specific
 * string or is empty.
 */

/**
 * @see {@link https://fresh.deno.dev/docs/examples/writing-tests|Writing tests} example on how to write tests for Fresh projects.
 */
const handler = await createHandler(manifest, options);

function assertHtml(resp: Response) {
  assertInstanceOf(resp.body, ReadableStream);
  assertEquals(resp.headers.get("content-type"), "text/html; charset=utf-8");
}

function assertJson(resp: Response) {
  assertInstanceOf(resp.body, ReadableStream);
  assertEquals(resp.headers.get("content-type"), "application/json");
}

function assertXml(resp: Response) {
  assertInstanceOf(resp.body, ReadableStream);
  assertEquals(
    resp.headers.get("content-type"),
    "application/atom+xml; charset=utf-8",
  );
}

function assertText(resp: Response) {
  assertInstanceOf(resp.body, ReadableStream);
  assertEquals(resp.headers.get("content-type"), "text/plain;charset=UTF-8");
}

function assertRedirect(response: Response, location: string) {
  assert(isRedirectStatus(response.status));
  assert(response.headers.get("location")?.includes(location));
}

function setupEnv(overrides: Record<string, string | null> = {}) {
  const defaults: Record<string, string> = {
    "STRIPE_SECRET_KEY": crypto.randomUUID(),
    "STRIPE_WEBHOOK_SECRET": crypto.randomUUID(),
    "STRIPE_PREMIUM_PLAN_PRICE_ID": crypto.randomUUID(),
    "GITHUB_CLIENT_ID": crypto.randomUUID(),
    "GITHUB_CLIENT_SECRET": crypto.randomUUID(),
    // Add more default values here
  };

  // Merge defaults and overrides
  const combinedEnvVars = { ...defaults, ...overrides };

  // Set or delete environment variables
  for (const [key, value] of Object.entries(combinedEnvVars)) {
    if (value === null) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
}

Deno.test("[e2e] security headers", async () => {
  setupEnv();
  const resp = await handler(new Request("http://localhost"));

  assertEquals(
    resp.headers.get("strict-transport-security"),
    "max-age=63072000;",
  );
  assertEquals(
    resp.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assertEquals(resp.headers.get("x-content-type-options"), "nosniff");
  assertEquals(resp.headers.get("x-frame-options"), "SAMEORIGIN");
  assertEquals(resp.headers.get("x-xss-protection"), "1; mode=block");
});

Deno.test("[e2e] GET /", async () => {
  setupEnv();
  const resp = await handler(new Request("http://localhost"));

  assertEquals(resp.status, STATUS_CODE.OK);
  assertHtml(resp);
});

Deno.test("[e2e] GET /callback", async (test) => {
  setupEnv();
  const login = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  await test.step("creates a new user if it doesn't already exist", async () => {
    const handleCallbackResp = {
      response: new Response(),
      tokens: {
        accessToken: crypto.randomUUID(),
        tokenType: crypto.randomUUID(),
      },
      sessionId,
    };
    const id = crypto.randomUUID();
    const handleCallbackStub = stub(
      _internals,
      "handleCallback",
      returnsNext([Promise.resolve(handleCallbackResp)]),
    );
    const githubRespBody = {
      login,
      email: crypto.randomUUID(),
    };
    const stripeRespBody: Partial<Stripe.Response<Stripe.Customer>> = { id };
    const fetchStub = stub(
      window,
      "fetch",
      returnsNext([
        Promise.resolve(Response.json(githubRespBody)),
        Promise.resolve(Response.json(stripeRespBody)),
      ]),
    );
    const req = new Request("http://localhost/callback");
    await handler(req);
    handleCallbackStub.restore();
    fetchStub.restore();

    const user = await getUser(githubRespBody.login);
    assert(user !== null);
    assertEquals(user.sessionId, handleCallbackResp.sessionId);
  });

  await test.step("updates the user session ID if they already exist", async () => {
    const handleCallbackResp = {
      response: new Response(),
      tokens: {
        accessToken: crypto.randomUUID(),
        tokenType: crypto.randomUUID(),
      },
      sessionId: crypto.randomUUID(),
    };
    const id = crypto.randomUUID();
    const handleCallbackStub = stub(
      _internals,
      "handleCallback",
      returnsNext([Promise.resolve(handleCallbackResp)]),
    );
    const githubRespBody = {
      login,
      email: crypto.randomUUID(),
    };
    const stripeRespBody: Partial<Stripe.Response<Stripe.Customer>> = { id };
    const fetchStub = stub(
      window,
      "fetch",
      returnsNext([
        Promise.resolve(Response.json(githubRespBody)),
        Promise.resolve(Response.json(stripeRespBody)),
      ]),
    );
    const req = new Request("http://localhost/callback");
    await handler(req);
    handleCallbackStub.restore();
    fetchStub.restore();

    const user = await getUser(githubRespBody.login);
    assert(user !== null);
    assertNotEquals(user.sessionId, sessionId);
  });
});

Deno.test("[e2e] GET /pricing", async () => {
  setupEnv({
    "STRIPE_SECRET_KEY": null,
    "STRIPE_PREMIUM_PLAN_PRICE_ID": null,
  });
  const handler = await createHandler(manifest, options);
  const resp = await handler(
    new Request("http://localhost/pricing"),
  );

  assertEquals(resp.status, STATUS_CODE.NotFound);
  assertHtml(resp);
});

Deno.test("[e2e] GET /signin", async () => {
  setupEnv();
  const resp = await handler(
    new Request("http://localhost/signin"),
  );

  assertRedirect(
    resp,
    "https://github.com/login/oauth/authorize",
  );
});

Deno.test("[e2e] GET /signout", async () => {
  setupEnv();
  const resp = await handler(
    new Request("http://localhost/signout"),
  );

  assertRedirect(resp, "/");
});

Deno.test("[e2e] GET /api/users", async () => {
  setupEnv();
  const user1 = randomUser();
  const user2 = randomUser();
  await createUser(user1);
  await createUser(user2);

  const req = new Request("http://localhost/api/users");
  const resp = await handler(req);

  const { values } = await resp.json();

  assertEquals(resp.status, STATUS_CODE.OK);
  assertJson(resp);
  assertArrayIncludes(values, [user1, user2]);
});

Deno.test("[e2e] GET /api/users/[login]", async (test) => {
  setupEnv();
  const user = randomUser();
  const req = new Request("http://localhost/api/users/" + user.login);

  await test.step("serves not found response if user not found", async () => {
    const resp = await handler(req);

    assertEquals(resp.status, STATUS_CODE.NotFound);
    assertText(resp);
    assertEquals(await resp.text(), "User not found");
  });

  await test.step("serves user as JSON", async () => {
    await createUser(user);
    const resp = await handler(req);

    assertEquals(resp.status, STATUS_CODE.OK);
    assertJson(resp);
    assertEquals(await resp.json(), user);
  });
});

function createStripeEvent(
  type: Stripe.Event.Type,
  customer: string,
): Promise<Stripe.Event> {
  return Promise.resolve({
    id: "123",
    object: "event",
    api_version: null,
    created: 0,
    livemode: false,
    pending_webhooks: 0,
    type,
    request: null,
    data: {
      object: {
        customer,
      },
    },
  });
}

Deno.test("[e2e] POST /api/stripe-webhooks", async (test) => {
  const url = "http://localhost/api/stripe-webhooks";

  await test.step("serves not found response if Stripe is disabled", async () => {
    setupEnv(
      { "STRIPE_SECRET_KEY": null },
    );
    const resp = await handler(new Request(url, { method: "POST" }));

    assertEquals(resp.status, STATUS_CODE.NotFound);
    assertText(resp);
    assertEquals(await resp.text(), "Not Found");
  });

  await test.step("serves bad request response if `Stripe-Signature` header is missing", async () => {
    setupEnv();
    const resp = await handler(new Request(url, { method: "POST" }));

    assertEquals(resp.status, STATUS_CODE.BadRequest);
    assertText(resp);
    assertEquals(await resp.text(), "`Stripe-Signature` header is missing");
  });

  await test.step("serves internal server error response if `STRIPE_WEBHOOK_SECRET` environment variable is not set", async () => {
    setupEnv(
      { "STRIPE_WEBHOOK_SECRET": null },
    );
    const resp = await handler(
      new Request(url, {
        method: "POST",
        headers: { "Stripe-Signature": crypto.randomUUID() },
      }),
    );

    assertEquals(resp.status, STATUS_CODE.InternalServerError);
    assertText(resp);
    assertEquals(
      await resp.text(),
      "`STRIPE_WEBHOOK_SECRET` environment variable is not set",
    );
  });

  await test.step("serves bad request response if the event payload is invalid", async () => {
    setupEnv();
    const resp = await handler(
      new Request(url, {
        method: "POST",
        headers: { "Stripe-Signature": crypto.randomUUID() },
      }),
    );

    assertEquals(resp.status, STATUS_CODE.BadRequest);
    assertText(resp);
    assertEquals(
      await resp.text(),
      "No webhook payload was provided.",
    );
  });

  await test.step("serves not found response if the user is not found for subscription creation", async () => {
    const constructEventAsyncStub = stub(
      stripe.webhooks,
      "constructEventAsync",
      returnsNext([
        createStripeEvent("customer.subscription.created", "x"),
      ]),
    );

    const resp = await handler(
      new Request(url, {
        method: "POST",
        headers: { "Stripe-Signature": crypto.randomUUID() },
      }),
    );

    constructEventAsyncStub.restore();

    assertEquals(resp.status, STATUS_CODE.NotFound);
    assertText(resp);
    assertEquals(await resp.text(), "User not found");
  });

  await test.step("creates a subscription", async () => {
    const user = randomUser();
    await createUser(user);

    const constructEventAsyncStub = stub(
      stripe.webhooks,
      "constructEventAsync",
      returnsNext([
        createStripeEvent(
          "customer.subscription.created",
          user.stripeCustomerId!,
        ),
      ]),
    );

    const resp = await handler(
      new Request(url, {
        method: "POST",
        headers: { "Stripe-Signature": crypto.randomUUID() },
      }),
    );

    constructEventAsyncStub.restore();

    assertEquals(resp.status, STATUS_CODE.Created);
    assertEquals(await getUser(user.login), { ...user, isSubscribed: true });
  });

  await test.step("serves not found response if the user is not found for subscription deletion", async () => {
    const constructEventAsyncStub = stub(
      stripe.webhooks,
      "constructEventAsync",
      returnsNext([
        createStripeEvent("customer.subscription.deleted", "x"),
      ]),
    );

    const resp = await handler(
      new Request(url, {
        method: "POST",
        headers: { "Stripe-Signature": crypto.randomUUID() },
      }),
    );

    constructEventAsyncStub.restore();

    assertEquals(resp.status, STATUS_CODE.NotFound);
    assertText(resp);
    assertEquals(await resp.text(), "User not found");
  });

  await test.step("deletes a subscription", async () => {
    const user: User = { ...randomUser(), isSubscribed: true };
    await createUser(user);

    const constructEventAsyncStub = stub(
      stripe.webhooks,
      "constructEventAsync",
      returnsNext([
        createStripeEvent(
          "customer.subscription.deleted",
          user.stripeCustomerId!,
        ),
      ]),
    );

    const resp = await handler(
      new Request(url, {
        method: "POST",
        headers: { "Stripe-Signature": crypto.randomUUID() },
      }),
    );

    constructEventAsyncStub.restore();

    assertEquals(await getUser(user.login), { ...user, isSubscribed: false });
    assertEquals(resp.status, STATUS_CODE.Accepted);
  });

  await test.step("serves bad request response if the event type is not supported", async () => {
    const constructEventAsyncStub = stub(
      stripe.webhooks,
      "constructEventAsync",
      returnsNext([
        createStripeEvent("account.application.authorized", "x"),
      ]),
    );

    const resp = await handler(
      new Request(url, {
        method: "POST",
        headers: { "Stripe-Signature": crypto.randomUUID() },
      }),
    );

    constructEventAsyncStub.restore();

    assertEquals(resp.status, STATUS_CODE.BadRequest);
    assertText(resp);
    assertEquals(await resp.text(), "Event type not supported");
  });
});

Deno.test("[e2e] GET /account", async (test) => {
  setupEnv();
  const url = "http://localhost/account";

  await test.step("redirects to sign-in page if the session user is not signed in", async () => {
    const resp = await handler(new Request(url));

    assertRedirect(resp, "/signin");
  });

  await test.step("serves a web page for signed-in free user", async () => {
    const user = randomUser();
    await createUser(user);

    const resp = await handler(
      new Request(url, {
        headers: { cookie: "site-session=" + user.sessionId },
      }),
    );

    assertEquals(resp.status, STATUS_CODE.OK);
    assertHtml(resp);
    assertStringIncludes(await resp.text(), 'href="/account/upgrade"');
  });

  await test.step("serves a web page for signed-in premium user", async () => {
    const user = randomUser();
    await createUser({ ...user, isSubscribed: true });

    const resp = await handler(
      new Request(url, {
        headers: { cookie: "site-session=" + user.sessionId },
      }),
    );

    assertEquals(resp.status, STATUS_CODE.OK);
    assertHtml(resp);
    assertStringIncludes(await resp.text(), 'href="/account/manage"');
  });
});

Deno.test("[e2e] GET /account/manage", async (test) => {
  setupEnv();
  const url = "http://localhost/account/manage";

  await test.step("redirects to sign-in page if the session user is not signed in", async () => {
    const resp = await handler(new Request(url));

    assertRedirect(resp, "/signin");
  });

  await test.step("serves not found response if the session user does not have a Stripe customer ID", async () => {
    const user = randomUser();
    await createUser({ ...user, stripeCustomerId: undefined });
    const resp = await handler(
      new Request(url, {
        headers: { cookie: "site-session=" + user.sessionId },
      }),
    );

    assertEquals(resp.status, STATUS_CODE.NotFound);
    assertHtml(resp);
  });

  await test.step("redirects to the URL returned by Stripe after creating a billing portal session", async () => {
    const user = randomUser();
    await createUser(user);

    const session = { url: "https://stubbing-returned-url" } as Stripe.Response<
      Stripe.BillingPortal.Session
    >;
    const sessionsCreateStub = stub(
      stripe.billingPortal.sessions,
      "create",
      resolvesNext([session]),
    );

    const resp = await handler(
      new Request(url, {
        headers: { cookie: "site-session=" + user.sessionId },
      }),
    );

    sessionsCreateStub.restore();

    assertRedirect(resp, session.url);
  });
});

Deno.test("[e2e] GET /account/upgrade", async (test) => {
  setupEnv();
  const url = "http://localhost/account/upgrade";

  await test.step("redirects to sign-in page if the session user is not signed in", async () => {
    const resp = await handler(new Request(url));

    assertRedirect(resp, "/signin");
  });

  const user = randomUser();
  await createUser(user);

  await test.step("serves internal server error response if the `STRIPE_PREMIUM_PLAN_PRICE_ID` environment variable is not set", async () => {
    setupEnv(
      { "STRIPE_PREMIUM_PLAN_PRICE_ID": null },
    );

    const resp = await handler(
      new Request(url, {
        headers: { cookie: "site-session=" + user.sessionId },
      }),
    );

    assertEquals(resp.status, STATUS_CODE.InternalServerError);
    assertHtml(resp);
  });

  await test.step("serves not found response if Stripe is disabled", async () => {
    setupEnv(
      { "STRIPE_SECRET_KEY": null },
    );

    const resp = await handler(
      new Request(url, {
        headers: { cookie: "site-session=" + user.sessionId },
      }),
    );

    assertEquals(resp.status, STATUS_CODE.NotFound);
    assertHtml(resp);
  });

  await test.step("serves not found response if Stripe returns a `null` URL", async () => {
    setupEnv();

    const session = { url: null } as Stripe.Response<
      Stripe.Checkout.Session
    >;
    const sessionsCreateStub = stub(
      stripe.checkout.sessions,
      "create",
      resolvesNext([session]),
    );

    const resp = await handler(
      new Request(url, {
        headers: { cookie: "site-session=" + user.sessionId },
      }),
    );

    sessionsCreateStub.restore();

    assertEquals(resp.status, STATUS_CODE.NotFound);
    assertHtml(resp);
  });

  await test.step("redirects to the URL returned by Stripe after creating a checkout session", async () => {
    const priceId = crypto.randomUUID();
    setupEnv(
      { "STRIPE_PREMIUM_PLAN_PRICE_ID": priceId },
    );

    const session = { url: "https://stubbing-returned-url" } as Stripe.Response<
      Stripe.Checkout.Session
    >;
    const sessionsCreateStub = stub(
      stripe.checkout.sessions,
      "create",
      resolvesNext([session]),
    );

    const resp = await handler(
      new Request(url, {
        headers: { cookie: "site-session=" + user.sessionId },
      }),
    );

    sessionsCreateStub.restore();

    assertRedirect(resp, session.url!);
  });
});