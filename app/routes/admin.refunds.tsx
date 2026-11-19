import { useEffect } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AlertTriangle, ReceiptText } from "lucide-react";
import type { Route } from "./+types/admin.refunds";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { db } from "~/db";
import { UserRole, users } from "~/db/schema";
import {
  buildRefundDecisionEmail,
  decideRefundRequest,
  listOpenRefundRequests,
  type RefundDecisionError,
} from "~/lib/refunds.server";
import { formatPrice } from "~/lib/utils";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";

const MAX_NOTE_LENGTH = 1000;

const decisionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundRequestId: z.coerce.number().int(),
    decisionNote: z
      .string()
      .trim()
      .max(MAX_NOTE_LENGTH, "Please keep the note under 1000 characters.")
      .optional()
      .transform((note) => (note ? note : null)),
  }),
  z.object({
    intent: z.literal("decline"),
    refundRequestId: z.coerce.number().int(),
    decisionNote: z
      .string({ required_error: "Write a Decision Note to decline." })
      .trim()
      .min(1, "Write a Decision Note to decline.")
      .max(MAX_NOTE_LENGTH, "Please keep the note under 1000 characters."),
  }),
]);

const decisionErrors: Record<RefundDecisionError, { message: string; status: number }> = {
  "not-found": { message: "That refund request does not exist.", status: 404 },
  "not-open": {
    message: "That refund request has already been decided.",
    status: 409,
  },
  "own-request": {
    message: "Another Platform Admin has to decide your own refund request.",
    status: 403,
  },
};

async function requirePlatformAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }
  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();
  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only Platform Admins can decide refund requests.", {
      status: 403,
    });
  }
  return currentUser;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline open refund requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const platformAdmin = await requirePlatformAdmin(request);
  return {
    platformAdminId: platformAdmin.id,
    openRefundRequests: listOpenRefundRequests(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const platformAdmin = await requirePlatformAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, decisionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { intent, refundRequestId, decisionNote } = parsed.data;
  const decision =
    intent === "approve"
      ? { kind: "approve" as const, decisionNote }
      : { kind: "decline" as const, decisionNote };

  const result = decideRefundRequest(
    refundRequestId,
    platformAdmin.id,
    decision
  );

  if (!result.ok) {
    const { message, status } = decisionErrors[result.error];
    return data({ error: message }, { status });
  }

  const email = buildRefundDecisionEmail(result.decided, decision);
  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return { decided: intent };
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { platformAdminId, openRefundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          {openRefundRequests.length === 0
            ? "No refund requests are waiting for a decision."
            : openRefundRequests.length === 1
              ? "One refund request is waiting for a decision, oldest first."
              : `${openRefundRequests.length} refund requests are waiting for a decision, oldest first.`}
        </p>
      </div>

      <div className="space-y-4">
        {openRefundRequests.map((refundRequest) => (
          <RefundRequestCard
            key={refundRequest.id}
            refundRequest={refundRequest}
            isOwnRequest={refundRequest.learnerId === platformAdminId}
          />
        ))}
      </div>
    </div>
  );
}

function RefundRequestCard({
  refundRequest,
  isOwnRequest,
}: {
  refundRequest: Route.ComponentProps["loaderData"]["openRefundRequests"][number];
  isOwnRequest: boolean;
}) {
  const fetcher = useFetcher<{ error?: string; decided?: string }>();
  const isSubmitting = fetcher.state !== "idle";
  const noteId = `decision-note-${refundRequest.id}`;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) toast.error(fetcher.data.error);
    if (fetcher.data.decided === "approve") toast.success("Refund approved.");
    if (fetcher.data.decided === "decline") {
      toast.success("Refund request declined.");
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              to={`/courses/${refundRequest.courseSlug}`}
              className="font-semibold hover:underline"
            >
              {refundRequest.courseTitle}
            </Link>
            <p className="text-sm text-muted-foreground">
              {refundRequest.learnerName} · {refundRequest.learnerEmail}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">
              {formatPrice(refundRequest.refundAmount)}
            </p>
            {refundRequest.isTeamPurchase && (
              <p className="text-xs text-muted-foreground">
                Team Purchase: unclaimed seats will be voided
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-sm">
          <ReceiptText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p>{refundRequest.reason}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Purchased{" "}
              {new Date(refundRequest.purchasedAt).toLocaleDateString()} ·
              raised {new Date(refundRequest.requestedAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        {isOwnRequest ? (
          <p className="text-sm text-muted-foreground">
            This is your own refund request. Another Platform Admin has to
            decide it.
          </p>
        ) : (
          <fetcher.Form method="post" className="space-y-2">
            <input
              type="hidden"
              name="refundRequestId"
              value={refundRequest.id}
            />
            <Label htmlFor={noteId}>Decision Note</Label>
            <Textarea
              id={noteId}
              name="decisionNote"
              rows={2}
              maxLength={MAX_NOTE_LENGTH}
              placeholder="Sent to the learner. Required to decline, optional to approve."
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                name="intent"
                value="approve"
                size="sm"
                disabled={isSubmitting}
              >
                Approve
              </Button>
              <Button
                type="submit"
                name="intent"
                value="decline"
                variant="outline"
                size="sm"
                disabled={isSubmitting}
              >
                Decline
              </Button>
            </div>
          </fetcher.Form>
        )}
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only Platform Admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
