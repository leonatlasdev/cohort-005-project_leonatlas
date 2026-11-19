import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

const { checkRefundEligibility, buildRefundRequestEmail } = await import(
  "./refunds.server"
);

let learnerId: number;
let courseId: number;
let lessonId: number;

const PURCHASED_AT = new Date(2026, 10, 1, 23, 0);

function buy(amountPaid: number, country: string | null = null) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: learnerId,
      courseId,
      amountPaid,
      country,
      createdAt: PURCHASED_AT.toISOString(),
    })
    .returning()
    .get();
}

function daysAfterPurchase(days: number) {
  const when = new Date(PURCHASED_AT);
  when.setDate(when.getDate() + days);
  when.setHours(12, 0);
  return when;
}

beforeEach(() => {
  testDb = createTestDb();
  const base = seedBaseData(testDb);
  learnerId = base.user.id;
  courseId = base.course.id;
  const module = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  lessonId = testDb
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson", position: 1 })
    .returning()
    .get().id;
});

describe("checkRefundEligibility", () => {
  it("is eligible inside the Refund Window, refunding what was paid", () => {
    const purchase = buy(5000);

    expect(checkRefundEligibility(learnerId, courseId, daysAfterPurchase(3)))
      .toEqual({
        eligible: true,
        purchaseId: purchase.id,
        refundAmount: 5000,
        lastDayOfWindow: "2026-11-15",
      });
  });

  it("refunds what was paid even when a coupon made it less than list price", () => {
    // List price is irrelevant: the Refund Amount is never more than was paid.
    testDb
      .update(schema.courses)
      .set({ price: 10000 })
      .run();
    buy(2500, null);

    const result = checkRefundEligibility(learnerId, courseId, daysAfterPurchase(1));

    expect(result).toMatchObject({ eligible: true, refundAmount: 2500 });
  });

  it("counts the window in whole calendar days, including the fourteenth", () => {
    buy(5000);

    expect(
      checkRefundEligibility(learnerId, courseId, daysAfterPurchase(14))
    ).toMatchObject({ eligible: true });
    expect(
      checkRefundEligibility(learnerId, courseId, daysAfterPurchase(15))
    ).toEqual({ eligible: false, reason: "outside-window" });
  });

  it("is not eligible without a purchase", () => {
    expect(checkRefundEligibility(learnerId, courseId, daysAfterPurchase(1)))
      .toEqual({ eligible: false, reason: "no-purchase" });
  });

  it("allows only one Open Refund Request, but a new one after a Decline", () => {
    const purchase = buy(5000);
    testDb
      .insert(schema.refunds)
      .values({ purchaseId: purchase.id, reason: "Not for me, sorry." })
      .returning()
      .get();

    expect(
      checkRefundEligibility(learnerId, courseId, daysAfterPurchase(1))
    ).toEqual({ eligible: false, reason: "open-request" });

    testDb
      .update(schema.refunds)
      .set({ status: schema.RefundStatus.Declined })
      .run();
    expect(
      checkRefundEligibility(learnerId, courseId, daysAfterPurchase(1))
    ).toMatchObject({ eligible: true });
  });

  it("is not eligible for a Claimed Team Seat", () => {
    const purchase = buy(5000);
    const team = testDb.insert(schema.teams).values({}).returning().get();
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId,
        code: "SEAT-1",
        purchaseId: purchase.id,
        redeemedByUserId: learnerId,
        redeemedAt: PURCHASED_AT.toISOString(),
      })
      .run();

    expect(
      checkRefundEligibility(learnerId, courseId, daysAfterPurchase(1))
    ).toEqual({ eligible: false, reason: "claimed-team-seat" });
  });

  it("is not eligible after two hours watched, however many lessons are completed", () => {
    buy(5000);
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: learnerId,
        lessonId,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
    const watch = (positionSeconds: number) =>
      testDb
        .insert(schema.videoWatchEvents)
        .values({ userId: learnerId, lessonId, eventType: "progress", positionSeconds })
        .run();

    // Every lesson completed, but under two hours watched: still eligible.
    watch(2 * 60 * 60 - 1);
    expect(
      checkRefundEligibility(learnerId, courseId, daysAfterPurchase(1))
    ).toMatchObject({ eligible: true });

    watch(2 * 60 * 60);
    expect(
      checkRefundEligibility(learnerId, courseId, daysAfterPurchase(1))
    ).toEqual({ eligible: false, reason: "watched-too-much" });
  });
});

describe("buildRefundRequestEmail", () => {
  it("speaks of a refund request, never a reversal or chargeback", () => {
    const email = buildRefundRequestEmail({
      learnerName: "Ada",
      learnerEmail: "ada@example.com",
      courseTitle: "Test Course",
      refundAmount: 2500,
    });

    expect(email.subject).toBe("Refund request received — Test Course");
    expect(email.body).toContain("refund request");
    expect(email.body).toContain("$25.00, the amount you paid");
    expect(`${email.subject} ${email.body}`).not.toMatch(
      /reversal|chargeback|cancel/i
    );
  });
});
