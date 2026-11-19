import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessons,
  modules,
  purchases,
  refunds,
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
