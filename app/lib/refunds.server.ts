import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  coupons,
  enrollments,
  lessons,
  modules,
  purchases,
  refunds,
  users,
  videoWatchEvents,
  RefundStatus,
} from "~/db/schema";
import { formatPrice } from "~/lib/utils";

// See GLOSSARY.md (Refunds) for the language used in this module.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;

export type RefundIneligibleReason =
  | "no-purchase"
  | "open-request"
  | "claimed-team-seat"
  | "outside-window"
  | "watched-too-much";

export type RefundEligibility =
  | {
      eligible: true;
      purchaseId: number;
      refundAmount: number;
      lastDayOfWindow: string;
    }
  | { eligible: false; reason: RefundIneligibleReason };

// The Refund Window is counted in whole calendar days, not hours — someone who
// buys at 23:00 still gets the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

function getLatestPurchase(learnerId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(
      and(eq(purchases.userId, learnerId), eq(purchases.courseId, courseId))
    )
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function hasOpenRefundRequest(purchaseId: number) {
  const row = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Open)
      )
    )
    .get();
  return row !== undefined;
}

function isClaimedTeamSeat(purchaseId: number) {
  const row = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();
  return row !== undefined;
}

function getSecondsWatched(learnerId: number, courseId: number) {
  const lessonIds = db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);

  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, learnerId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

/**
 * Refund Eligibility for a Learner's latest purchase of a course: inside the
 * Refund Window, not a Claimed Team Seat, and under two hours watched. A
 * purchase with an Open Refund Request cannot have a second one.
 */
export function checkRefundEligibility(
  learnerId: number,
  courseId: number,
  now: Date = new Date()
): RefundEligibility {
  const purchase = getLatestPurchase(learnerId, courseId);
  if (!purchase) return { eligible: false, reason: "no-purchase" };

  if (hasOpenRefundRequest(purchase.id)) {
    return { eligible: false, reason: "open-request" };
  }

  if (isClaimedTeamSeat(purchase.id)) {
    return { eligible: false, reason: "claimed-team-seat" };
  }

  const purchasedAt = new Date(purchase.createdAt);
  const windowEnd = new Date(purchase.createdAt);
  windowEnd.setDate(windowEnd.getDate() + REFUND_WINDOW_DAYS);
  const firstDayOfWindow = calendarDay(purchasedAt);
  const lastDayOfWindow = calendarDay(windowEnd);
  const today = calendarDay(now);

  if (today < firstDayOfWindow || today > lastDayOfWindow) {
    return { eligible: false, reason: "outside-window" };
  }

  if (getSecondsWatched(learnerId, courseId) >= REFUND_WATCH_LIMIT_SECONDS) {
    return { eligible: false, reason: "watched-too-much" };
  }

  // The Refund Amount is always exactly what the Learner paid.
  return {
    eligible: true,
    purchaseId: purchase.id,
    refundAmount: purchase.amountPaid,
    lastDayOfWindow,
  };
}

/**
 * The confirmation the Learner gets in their inbox when they raise a Refund
 * Request. There is no mail transport wired up yet, so the built message goes
 * to the server log.
 */
export function buildRefundRequestEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  refundAmount: number;
}) {
  return {
    to: input.learnerEmail,
    subject: `Refund request received — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      `We have your refund request for "${input.courseTitle}".`,
      `If it is approved, we will refund ${formatPrice(input.refundAmount)}, the amount you paid.`,
      "",
      "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again once it has been approved or declined.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

// ─── Team Purchase seats ───

export type SeatClaimBlock = "voided" | "refund-open";

/**
 * Why a seat from a Team Purchase cannot be claimed right now, or null if it
 * can. Seats are frozen while the Team Purchase has an Open Refund Request,
 * and voided for good once it is Refunded (docs/adr/0004).
 */
export function getSeatClaimBlock(seat: {
  voidedAt: string | null;
  purchaseId: number;
}): SeatClaimBlock | null {
  if (seat.voidedAt !== null) return "voided";
  if (hasOpenRefundRequest(seat.purchaseId)) return "refund-open";
  return null;
}

// ─── Deciding a Refund Request ───

export type RefundDecision =
  | { kind: "approve"; decisionNote: string | null }
  | { kind: "decline"; decisionNote: string };

export type RefundDecisionError = "not-found" | "not-open" | "own-request";

type DecidedRefundRequest = {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  refundAmount: number;
};

/**
 * A Platform Admin approves or declines an Open Refund Request. Eligibility is
 * deliberately not re-checked here (docs/adr/0001).
 *
 * Approving records the Refund for the full Refund Amount. For a Team Purchase
 * it voids every unclaimed seat (docs/adr/0004); otherwise it turns the
 * Learner's Enrollment into an Ended Enrollment (docs/adr/0003). No money
 * moves: there is no payment provider yet.
 */
export function decideRefundRequest(
  refundRequestId: number,
  platformAdminId: number,
  decision: RefundDecision,
  now: Date = new Date()
):
  | { ok: true; decided: DecidedRefundRequest }
  | { ok: false; error: RefundDecisionError } {
  return db.transaction((tx) => {
    const row = tx
      .select({
        status: refunds.status,
        purchaseId: purchases.id,
        learnerId: purchases.userId,
        courseId: purchases.courseId,
        amountPaid: purchases.amountPaid,
        learnerName: users.name,
        learnerEmail: users.email,
        courseTitle: courses.title,
      })
      .from(refunds)
      .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
      .innerJoin(users, eq(purchases.userId, users.id))
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(eq(refunds.id, refundRequestId))
      .get();

    if (!row) return { ok: false, error: "not-found" } as const;
    if (row.status !== RefundStatus.Open) {
      return { ok: false, error: "not-open" } as const;
    }
    if (row.learnerId === platformAdminId) {
      return { ok: false, error: "own-request" } as const;
    }

    const resolvedAt = now.toISOString();
    const approved = decision.kind === "approve";

    tx.update(refunds)
      .set({
        status: approved ? RefundStatus.Approved : RefundStatus.Declined,
        amountRefunded: approved ? row.amountPaid : null,
        decisionNote: decision.decisionNote,
        resolvedAt,
        resolvedByUserId: platformAdminId,
      })
      .where(eq(refunds.id, refundRequestId))
      .run();

    if (approved) {
      const isTeamPurchase =
        tx
          .select({ id: coupons.id })
          .from(coupons)
          .where(eq(coupons.purchaseId, row.purchaseId))
          .get() !== undefined;

      if (isTeamPurchase) {
        tx.update(coupons)
          .set({ voidedAt: resolvedAt })
          .where(
            and(
              eq(coupons.purchaseId, row.purchaseId),
              isNull(coupons.redeemedAt),
              isNull(coupons.voidedAt)
            )
          )
          .run();
      } else {
        tx.update(enrollments)
          .set({ endedAt: resolvedAt })
          .where(
            and(
              eq(enrollments.userId, row.learnerId),
              eq(enrollments.courseId, row.courseId),
              isNull(enrollments.endedAt)
            )
          )
          .run();
      }
    }

    return {
      ok: true,
      decided: {
        learnerName: row.learnerName,
        learnerEmail: row.learnerEmail,
        courseTitle: row.courseTitle,
        refundAmount: row.amountPaid,
      },
    } as const;
  });
}

export function buildRefundDecisionEmail(
  decided: DecidedRefundRequest,
  decision: RefundDecision
) {
  const approved = decision.kind === "approve";
  const noteLines = decision.decisionNote
    ? ["", "A note from our team:", decision.decisionNote]
    : [];

  return {
    to: decided.learnerEmail,
    subject: approved
      ? `Refund approved — ${decided.courseTitle}`
      : `Refund request declined — ${decided.courseTitle}`,
    body: [
      `Hi ${decided.learnerName},`,
      "",
      approved
        ? `We have approved your refund request for "${decided.courseTitle}". We are refunding ${formatPrice(decided.refundAmount)}, the amount you paid, and your access to the course has ended. You can buy it again at any time, and your progress will still be there.`
        : `We have declined your refund request for "${decided.courseTitle}". You still have full access to the course.`,
      ...noteLines,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

// ─── Listings ───

/** Open Refund Requests for the Platform Admin queue, oldest first. */
export function listOpenRefundRequests() {
  return db
    .select({
      id: refunds.id,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      purchaseId: purchases.id,
      purchasedAt: purchases.createdAt,
      refundAmount: purchases.amountPaid,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      isTeamPurchase: sql<number>`exists (select 1 from ${coupons} where ${coupons.purchaseId} = ${purchases.id})`,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.status, RefundStatus.Open))
    .orderBy(asc(refunds.requestedAt), asc(refunds.id))
    .all()
    .map((row) => ({ ...row, isTeamPurchase: Boolean(row.isTeamPurchase) }));
}

/** Every Refund Request a Learner has raised, newest first. */
export function listRefundRequestsForLearner(learnerId: number) {
  return db
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      decisionNote: refunds.decisionNote,
      requestedAt: refunds.requestedAt,
      resolvedAt: refunds.resolvedAt,
      refundAmount: purchases.amountPaid,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(purchases.userId, learnerId))
    .orderBy(desc(refunds.requestedAt), desc(refunds.id))
    .all();
}
