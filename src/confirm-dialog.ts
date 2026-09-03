// Pure copy + focus contract for the reusable destructive-confirm dialog.
// No DOM — the annotator owns rendering/focus, this module owns the words.

export type ConfirmKind = "clear-all" | "delete-current";

export type ConfirmContent = {
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
};

export function confirmDialogContent(kind: ConfirmKind, details: { count?: number; elementLabel?: string } = {}): ConfirmContent {
  if (kind === "delete-current") {
    return {
      title: "Delete this annotation?",
      body: details.elementLabel
        ? `This removes your annotation on “${details.elementLabel}”.`
        : "This removes the annotation you are editing.",
      cancelLabel: "Cancel",
      confirmLabel: "Delete",
    };
  }
  const count = Math.max(1, details.count || 1);
  return {
    title: "Delete all annotations?",
    body: count === 1 ? "This removes the annotation on this page." : `This removes all ${count} annotations on this page.`,
    cancelLabel: "Cancel",
    confirmLabel: "Delete",
  };
}

/** Initial focus is always Cancel — Enter must never confirm by accident. */
export const CONFIRM_INITIAL_FOCUS = "cancel" as const;
