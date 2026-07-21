import type { NextBestAction } from "./types";

export function actionKey(action: Pick<NextBestAction, "category" | "subject" | "targetLevel">) {
  return `${action.category}:${action.subject}:${action.targetLevel ?? "unlock"}`;
}
