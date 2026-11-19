import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

const {
  checkRefundEligibility,
  buildRefundRequestEmail,
  buildRefundDecisionEmail,
  decideRefundRequest,
  getSeatClaimBlock,
  listOpenRefundRequests,
  listRefundRequestsForLearner,
} = await import("./refunds.server");
const { enrollLearner, findActiveEnrollment } = await import(
  "./enrollments.server"
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

describe("deciding a Refund Request", () => {
  let platformAdminId: number;

  beforeEach(() => {
    platformAdminId = testDb
      .insert(schema.users)
      .values({
        name: "Platform Admin",
        email: "platform-admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get().id;
  });

  function raiseRefundRequest(purchaseId: number) {
    return testDb
      .insert(schema.refunds)
      .values({ purchaseId, reason: "Not what I expected." })
      .returning()
      .get();
  }

  function getRefundRequest(id: number) {
    const row = testDb
      .select()
      .from(schema.refunds)
      .all()
      .find((refundRequest) => refundRequest.id === id);
    if (!row) throw new Error("refund request missing");
    return row;
  }

  function createTeamPurchase(seatCount: number) {
    const purchase = buy(15000);
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const seats = Array.from({ length: seatCount }, (_, i) =>
      testDb
        .insert(schema.coupons)
        .values({
          teamId: team.id,
          courseId,
          code: `SEAT-${i}`,
          purchaseId: purchase.id,
        })
        .returning()
        .get()
    );
    return { purchase, seats };
  }

  it("approving records the full Refund and ends the Enrollment, keeping it", () => {
    const purchase = buy(5000);
    enrollLearner(learnerId, courseId);
    const refundRequest = raiseRefundRequest(purchase.id);

    const result = decideRefundRequest(
      refundRequest.id,
      platformAdminId,
      { kind: "approve", decisionNote: null },
      daysAfterPurchase(20)
    );

    expect(result).toMatchObject({ ok: true, decided: { refundAmount: 5000 } });
    expect(getRefundRequest(refundRequest.id)).toMatchObject({
      status: schema.RefundStatus.Approved,
      amountRefunded: 5000,
      resolvedByUserId: platformAdminId,
      decisionNote: null,
    });
    // An Ended Enrollment: no access, but the row (and progress) survives.
    expect(findActiveEnrollment(learnerId, courseId)).toBeUndefined();
    expect(testDb.select().from(schema.enrollments).all()).toHaveLength(1);
  });

  it("approves after the Refund Window has closed, without re-checking eligibility", () => {
    const purchase = buy(5000);
    const refundRequest = raiseRefundRequest(purchase.id);

    expect(
      decideRefundRequest(
        refundRequest.id,
        platformAdminId,
        { kind: "approve", decisionNote: null },
        daysAfterPurchase(60)
      )
    ).toMatchObject({ ok: true });
  });

  it("declining keeps the Enrollment and stores the Decision Note", () => {
    const purchase = buy(5000);
    enrollLearner(learnerId, courseId);
    const refundRequest = raiseRefundRequest(purchase.id);

    decideRefundRequest(refundRequest.id, platformAdminId, {
      kind: "decline",
      decisionNote: "You finished the course.",
    });

    expect(getRefundRequest(refundRequest.id)).toMatchObject({
      status: schema.RefundStatus.Declined,
      amountRefunded: null,
      decisionNote: "You finished the course.",
    });
    expect(findActiveEnrollment(learnerId, courseId)).toBeDefined();
  });

  it("refuses a Refund Request that has already been decided", () => {
    const refundRequest = raiseRefundRequest(buy(5000).id);
    const decline = {
      kind: "decline",
      decisionNote: "No.",
    } as const;

    decideRefundRequest(refundRequest.id, platformAdminId, decline);

    expect(
      decideRefundRequest(refundRequest.id, platformAdminId, decline)
    ).toEqual({ ok: false, error: "not-open" });
  });

  it("refuses a Platform Admin deciding their own Refund Request", () => {
    const refundRequest = raiseRefundRequest(buy(5000).id);

    expect(
      decideRefundRequest(refundRequest.id, learnerId, {
        kind: "approve",
        decisionNote: null,
      })
    ).toEqual({ ok: false, error: "own-request" });
    expect(getRefundRequest(refundRequest.id).status).toBe(
      schema.RefundStatus.Open
    );
  });

  it("freezes a Team Purchase's seats while Open, and voids unclaimed ones on approval", () => {
    const { purchase, seats } = createTeamPurchase(2);
    const refundRequest = raiseRefundRequest(purchase.id);

    expect(getSeatClaimBlock(seats[0])).toBe("refund-open");

    decideRefundRequest(refundRequest.id, platformAdminId, {
      kind: "approve",
      decisionNote: null,
    });

    const after = testDb.select().from(schema.coupons).all();
    expect(after.every((seat) => seat.voidedAt !== null)).toBe(true);
    expect(after.map((seat) => getSeatClaimBlock(seat))).toEqual([
      "voided",
      "voided",
    ]);
  });

  it("unfreezes a Team Purchase's seats when its Refund Request is Declined", () => {
    const { purchase, seats } = createTeamPurchase(1);
    const refundRequest = raiseRefundRequest(purchase.id);

    decideRefundRequest(refundRequest.id, platformAdminId, {
      kind: "decline",
      decisionNote: "Seats are still useful to your team.",
    });

    expect(getSeatClaimBlock(seats[0])).toBeNull();
  });

  it("lists Open requests oldest first, and every request for the Learner", () => {
    const first = raiseRefundRequest(buy(5000).id);
    const second = raiseRefundRequest(buy(5000).id);
    decideRefundRequest(first.id, platformAdminId, {
      kind: "decline",
      decisionNote: "Too late.",
    });

    expect(listOpenRefundRequests().map((row) => row.id)).toEqual([second.id]);
    expect(
      listRefundRequestsForLearner(learnerId).map((row) => row.status).sort()
    ).toEqual([schema.RefundStatus.Declined, schema.RefundStatus.Open]);
  });

  it("emails the Decision Note with the decision", () => {
    const decided = {
      learnerName: "Ada",
      learnerEmail: "ada@example.com",
      courseTitle: "Test Course",
      refundAmount: 2500,
    };

    const declined = buildRefundDecisionEmail(decided, {
      kind: "decline",
      decisionNote: "You watched most of it.",
    });
    expect(declined.subject).toBe("Refund request declined — Test Course");
    expect(declined.body).toContain("You watched most of it.");

    const approved = buildRefundDecisionEmail(decided, {
      kind: "approve",
      decisionNote: null,
    });
    expect(approved.subject).toBe("Refund approved — Test Course");
    expect(approved.body).toContain("$25.00, the amount you paid");
    expect(approved.body).not.toContain("A note from our team");
  });
});

describe("enrollLearner", () => {
  it("revives an Ended Enrollment instead of creating a second one", () => {
    const enrollment = enrollLearner(learnerId, courseId);
    testDb
      .update(schema.enrollments)
      .set({ endedAt: new Date().toISOString() })
      .run();

    const revived = enrollLearner(learnerId, courseId);

    expect(revived.id).toBe(enrollment.id);
    expect(revived.endedAt).toBeNull();
    expect(testDb.select().from(schema.enrollments).all()).toHaveLength(1);
  });
});
