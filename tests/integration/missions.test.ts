import { testBackend, asUser } from "../helpers/backend";
import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { SAMPLE_CSV, type MissionInput } from "../../lib/missions";
const modules = import.meta.glob("../../convex/**/*.ts");
const input = (): MissionInput => ({
  title: "Sales summary",
  serviceType: "csv_summary",
  inputCsv: SAMPLE_CSV,
  maxBudgetYocto: "10000000000000000000000000",
  acceptanceCriteria: "Preserve row count and report missing values.",
  deadlineAt: Date.now() + 86400000,
});
const paginationOpts = { numItems: 20, cursor: null };
async function setup() {
  const t = testBackend(schema, modules);
  const [a, b] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", { email: "alice@example.com" }),
      ctx.db.insert("users", { email: "bob@example.com" }),
    ]),
  );
  return {
    t,
    alice: await asUser(t, a),
    bob: await asUser(t, b),
  };
}
describe("private mission API", () => {
  it("rejects anonymous reads and all writes", async () => {
    const { t, alice } = await setup();
    const data = input();
    const id = await alice.mutation(api.missions.create, data);
    await expect(
      t.query(api.missions.list, { paginationOpts }),
    ).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.query(api.missions.get, { id })).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    await expect(t.mutation(api.missions.create, data)).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    await expect(
      t.mutation(api.missions.update, { id, ...data }),
    ).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.mutation(api.missions.remove, { id })).rejects.toThrow(
      "UNAUTHENTICATED",
    );
  });
  it("allows an owner to create, read, edit, and delete a persisted draft", async () => {
    const { alice } = await setup();
    const data = input();
    const id = await alice.mutation(api.missions.create, data);
    expect(await alice.query(api.missions.get, { id })).toMatchObject({
      ...data,
      state: "draft",
    });
    expect(
      (await alice.query(api.missions.list, { paginationOpts })).page,
    ).toHaveLength(1);
    await alice.mutation(api.missions.update, {
      id,
      ...data,
      title: "Updated",
    });
    expect((await alice.query(api.missions.get, { id })).title).toBe("Updated");
    await alice.mutation(api.missions.remove, { id });
    expect(
      (await alice.query(api.missions.list, { paginationOpts })).page,
    ).toEqual([]);
    await expect(alice.query(api.missions.get, { id })).rejects.toThrow(
      "MISSION_NOT_FOUND",
    );
  });
  it("isolates two users even when a mission ID is known", async () => {
    const { alice, bob } = await setup();
    const data = input();
    const id = await alice.mutation(api.missions.create, data);
    await bob.mutation(api.missions.create, {
      ...data,
      title: "Bob's mission",
    });
    expect(
      (await bob.query(api.missions.list, { paginationOpts })).page.map(
        (m) => m.title,
      ),
    ).toEqual(["Bob's mission"]);
    await expect(bob.query(api.missions.get, { id })).rejects.toThrow(
      "MISSION_NOT_FOUND",
    );
    await expect(
      bob.mutation(api.missions.update, { id, ...data }),
    ).rejects.toThrow("MISSION_NOT_FOUND");
    await expect(bob.mutation(api.missions.remove, { id })).rejects.toThrow(
      "MISSION_NOT_FOUND",
    );
    expect((await alice.query(api.missions.get, { id })).title).toBe(
      data.title,
    );
  });
  it("rejects an identity that does not refer to an existing user", async () => {
    const { t } = await setup();
    const ghost = t.withIdentity({ subject: "invalid-user|invalid-session" });
    await expect(
      ghost.mutation(api.missions.create, input()),
    ).rejects.toThrow();
  });
  it.each([
    { maxBudgetYocto: "1.5" },
    { maxBudgetYocto: "0" },
    { maxBudgetYocto: "01" },
    { maxBudgetYocto: "1000000000000000000000000001" },
    { deadlineAt: 1 },
    { title: " " },
    { acceptanceCriteria: "" },
    { inputCsv: "a,b\n1" },
    { inputCsv: "a,a\n1,2" },
    { inputCsv: "a\n" },
    { inputCsv: "a\n" + "x".repeat(65536) },
  ])("rejects invalid mission fields: %j", async (invalid) => {
    const { alice } = await setup();
    await expect(
      alice.mutation(api.missions.create, { ...input(), ...invalid }),
    ).rejects.toThrow();
    expect(
      (await alice.query(api.missions.list, { paginationOpts })).page,
    ).toEqual([]);
  });
  it("validates updates atomically", async () => {
    const { alice } = await setup();
    const data = input();
    const id = await alice.mutation(api.missions.create, data);
    await expect(
      alice.mutation(api.missions.update, {
        id,
        ...data,
        maxBudgetYocto: "-1",
      }),
    ).rejects.toThrow();
    expect((await alice.query(api.missions.get, { id })).maxBudgetYocto).toBe(
      data.maxBudgetYocto,
    );
  });
  it("paginates only the authenticated owner's missions", async () => {
    const { alice, bob } = await setup();
    for (let i = 0; i < 3; i++)
      await alice.mutation(api.missions.create, {
        ...input(),
        title: `A-${i}`,
      });
    await bob.mutation(api.missions.create, { ...input(), title: "private B" });
    const first = await alice.query(api.missions.list, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await alice.query(api.missions.list, {
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
    expect(
      [...first.page, ...second.page].every((m) => m.title.startsWith("A-")),
    ).toBe(true);
  });
});
