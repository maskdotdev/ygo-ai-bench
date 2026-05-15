import { describe, expect, it } from "vitest";
import { duelTriggerOrderView } from "../src/playtest-app/duel-trigger-order-view.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { TriggerOrderPromptState } from "#duel/types.js";

describe("duel trigger order view", () => {
  it("collects active trigger-order groups from grouped legal-action metadata", () => {
    const prompt: TriggerOrderPromptState = {
      id: "7:opponentOptional:1",
      type: "orderTriggers",
      player: 1,
      triggerBucket: "opponentOptional",
      triggerIds: ["first", "second"],
    };
    const activateGroup: DuelLegalActionGroup = {
      key: "7:triggerBucket:trigger-activate:opponentOptional:1",
      label: "Trigger Activations",
      windowId: 7,
      windowKind: "triggerBucket",
      triggerBucket: { player: 1, triggerBucket: "opponentOptional", triggerIds: ["first", "second"] },
      triggerOrderPrompt: prompt,
      actions: [
        { type: "activateTrigger", player: 1, triggerId: "first", triggerBucket: "opponentOptional", uid: "a", effectId: "first-effect", label: "First" },
        { type: "activateTrigger", player: 1, triggerId: "second", triggerBucket: "opponentOptional", uid: "b", effectId: "second-effect", label: "Second" },
      ],
    };
    const declineGroup: DuelLegalActionGroup = {
      key: "7:triggerBucket:trigger-decline:opponentOptional:1",
      label: "Trigger Declines",
      windowId: 7,
      windowKind: "triggerBucket",
      triggerBucket: { player: 1, triggerBucket: "opponentOptional", triggerIds: ["first"] },
      actions: [
        { type: "declineTrigger", player: 1, triggerId: "first", triggerBucket: "opponentOptional", uid: "a", effectId: "first-effect", label: "Decline First" },
      ],
    };
    const otherGroup: DuelLegalActionGroup = {
      key: "8:triggerBucket:trigger-activate:turnOptional:0",
      label: "Trigger Activations",
      windowId: 8,
      windowKind: "triggerBucket",
      triggerBucket: { player: 0, triggerBucket: "turnOptional", triggerIds: ["other"] },
      actions: [
        { type: "activateTrigger", player: 0, triggerId: "other", triggerBucket: "turnOptional", uid: "c", effectId: "other-effect", label: "Other" },
      ],
    };

    expect(duelTriggerOrderView(prompt, [activateGroup, declineGroup, otherGroup])).toEqual({
      label: "Trigger Order",
      detail: "P2 · opponentOptional · 2 triggers",
      groups: [activateGroup, declineGroup],
    });
  });

  it("stays hidden until engine exposes an active trigger-order prompt", () => {
    expect(duelTriggerOrderView(undefined, [])).toBeUndefined();
  });
});
