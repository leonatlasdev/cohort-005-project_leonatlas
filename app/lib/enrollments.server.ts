import { and, eq, isNull } from "drizzle-orm";
import { db } from "~/db";
import { enrollments } from "~/db/schema";

// An Enrollment gives access until a Refund turns it into an Ended Enrollment
// (see GLOSSARY.md and docs/adr/0003). Ended rows are kept, so every query that
// asks "is this Learner enrolled?" or "who is enrolled?" must filter on this.
export function isActiveEnrollment() {
  return isNull(enrollments.endedAt);
}

export function findActiveEnrollment(userId: number, courseId: number) {
  return db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, courseId),
        isActiveEnrollment()
      )
    )
    .get();
}

/**
 * Gives a Learner access to a course. An Ended Enrollment from an earlier,
 * Refunded purchase is revived rather than duplicated, so the Learner's
 * progress carries over.
 */
export function enrollLearner(userId: number, courseId: number) {
  const existing = db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();

  if (existing) {
    if (existing.endedAt === null) return existing;
    return db
      .update(enrollments)
      .set({ endedAt: null })
      .where(eq(enrollments.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(enrollments)
    .values({ userId, courseId })
    .returning()
    .get();
}
