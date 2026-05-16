import { isDuelPromptType } from "#duel/prompt-kinds.js";
import type { DuelPromptState, PlayerId } from "#duel/types.js";
import { isRecord, isSafeCount, isSafePlayerId, isSafeString } from "./parity-validation.js";

export function malformedFixturePromptExpectations(prompt: DuelPromptState | undefined): string[] {
  if (prompt === undefined) return [];
  if (!isRecord(prompt)) return [`Expected setup.prompt has malformed value ${String(prompt)}`];
  const failures: string[] = [];
  if (!isSafeString(prompt.id)) failures.push(`Expected setup.prompt.id has malformed value ${String(prompt.id)}`);
  if (!isDuelPromptType(prompt.type)) failures.push(`Expected setup.prompt.type has malformed value ${String(prompt.type)}`);
  if (!isSafePlayerId(prompt.player as PlayerId)) failures.push(`Expected setup.prompt.player has malformed player ${String(prompt.player)}`);
  if (prompt.returnTo !== undefined && !isSafePlayerId(prompt.returnTo as PlayerId)) failures.push(`Expected setup.prompt.returnTo has malformed player ${String(prompt.returnTo)}`);
  if (prompt.origin !== undefined && prompt.origin !== "luaOperation") failures.push(`Expected setup.prompt.origin has malformed value ${String(prompt.origin)}`);
  if (prompt.type === "selectOption") validateSelectOptionPrompt(prompt, failures);
  else if (prompt.type === "selectYesNo") validateSelectYesNoPrompt(prompt, failures);
  for (const key of Object.keys(prompt)) if (!["id", "type", "player", "options", "description", "descriptions", "descriptionLists", "returnTo", "origin"].includes(key)) failures.push(`Expected setup.prompt has malformed key ${key}`);
  return failures;
}

function validateSelectOptionPrompt(prompt: Record<string, unknown>, failures: string[]): void {
  if (!Array.isArray(prompt.options)) {
    failures.push(`Expected setup.prompt.options has malformed value ${String(prompt.options)}`);
    return;
  }
  prompt.options.forEach((option, index) => {
    if (!isSafeCount(option as number)) failures.push(`Expected setup.prompt.options[${index}] has malformed value ${String(option)}`);
  });
  if (new Set(prompt.options).size !== prompt.options.length) failures.push("Expected setup.prompt.options has duplicate values");
  if (prompt.descriptions !== undefined) {
    if (!Array.isArray(prompt.descriptions)) failures.push(`Expected setup.prompt.descriptions has malformed value ${String(prompt.descriptions)}`);
    else if (prompt.descriptions.length !== prompt.options.length) failures.push("Expected setup.prompt.descriptions must match options length");
    else prompt.descriptions.forEach((description, index) => {
      if (!isSafeCount(description as number)) failures.push(`Expected setup.prompt.descriptions[${index}] has malformed value ${String(description)}`);
    });
  }
  if (prompt.descriptionLists !== undefined) {
    if (!Array.isArray(prompt.descriptionLists)) failures.push(`Expected setup.prompt.descriptionLists has malformed value ${String(prompt.descriptionLists)}`);
    else if (prompt.descriptionLists.length !== prompt.options.length) failures.push("Expected setup.prompt.descriptionLists must match options length");
    else prompt.descriptionLists.forEach((descriptions, index) => {
      if (!Array.isArray(descriptions)) failures.push(`Expected setup.prompt.descriptionLists[${index}] has malformed value ${String(descriptions)}`);
      else descriptions.forEach((description, descriptionIndex) => {
        if (!isSafeCount(description as number)) failures.push(`Expected setup.prompt.descriptionLists[${index}][${descriptionIndex}] has malformed value ${String(description)}`);
      });
    });
  }
  if (prompt.description !== undefined) failures.push("Expected setup.prompt.description has malformed field for selectOption");
}

function validateSelectYesNoPrompt(prompt: Record<string, unknown>, failures: string[]): void {
  if (prompt.description !== undefined && !isSafeCount(prompt.description as number)) failures.push(`Expected setup.prompt.description has malformed value ${String(prompt.description)}`);
  if (prompt.options !== undefined) failures.push("Expected setup.prompt.options has malformed field for selectYesNo");
  if (prompt.descriptions !== undefined) failures.push("Expected setup.prompt.descriptions has malformed field for selectYesNo");
  if (prompt.descriptionLists !== undefined) failures.push("Expected setup.prompt.descriptionLists has malformed field for selectYesNo");
}
