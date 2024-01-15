// Copyright 2023-2024 the Deno authors. All rights reserved. MIT license.
import { assertEquals, assertRejects } from "std/assert/mod.ts";
import {
  createUser,
  getUser,
  getUserBySession,
  getUserByStripeCustomer,
  randomUser,
  updateUser,
  updateUserSession,
  type User,
} from "./db.ts";

Deno.test("[db] user", async () => {
  const user = randomUser();

  assertEquals(await getUser(user.login), null);
  assertEquals(await getUserBySession(user.sessionId), null);
  assertEquals(await getUserByStripeCustomer(user.stripeCustomerId!), null);

  await createUser(user);
  await assertRejects(async () => await createUser(user));
  assertEquals(await getUser(user.login), user);
  assertEquals(await getUserBySession(user.sessionId), user);
  assertEquals(await getUserByStripeCustomer(user.stripeCustomerId!), user);

  const subscribedUser: User = { ...user, isSubscribed: true };
  await updateUser(subscribedUser);
  assertEquals(await getUser(subscribedUser.login), subscribedUser);
  assertEquals(
    await getUserBySession(subscribedUser.sessionId),
    subscribedUser,
  );
  assertEquals(
    await getUserByStripeCustomer(subscribedUser.stripeCustomerId!),
    subscribedUser,
  );

  const newSessionId = crypto.randomUUID();
  await updateUserSession(user, newSessionId);
  assertEquals(await getUserBySession(user.sessionId), null);
  assertEquals(await getUserBySession(newSessionId), {
    ...user,
    sessionId: newSessionId,
  });

  await assertRejects(
    async () => await updateUserSession(user, newSessionId),
    Error,
    "Failed to update user session",
  );
});
