import { describe, expect, it } from "vitest";
import { copyDuelTriggerOrderView, duelTriggerOrderView } from "../src/playtest-app/duel-trigger-order-view.js";
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
      prompt,
      groups: [activateGroup, declineGroup],
    });
  });

  it("stays hidden until engine exposes an active trigger-order prompt", () => {
    expect(duelTriggerOrderView(undefined, [])).toBeUndefined();
  });

  it("deep-copies trigger-order groups for bridge payloads", () => {
    const prompt: TriggerOrderPromptState = {
      id: "9:turnMandatory:0",
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnMandatory",
      triggerIds: ["first", "second"],
    };
    const view = duelTriggerOrderView(prompt, [{
      key: "9:triggerBucket:trigger-activate:turnMandatory:0",
      label: "Trigger Activations",
      windowId: 9,
      windowKind: "triggerBucket",
      triggerBucket: { player: 0, triggerBucket: "turnMandatory", triggerIds: ["first", "second"] },
      triggerOrderPrompt: prompt,
      actions: [
        { type: "activateTrigger", player: 0, triggerId: "first", triggerBucket: "turnMandatory", uid: "a", effectId: "first-effect", label: "First" },
        { type: "activateTrigger", player: 0, triggerId: "second", triggerBucket: "turnMandatory", uid: "b", effectId: "second-effect", label: "Second" },
      ],
    }]);
    expect(view).toBeDefined();

    const copied = copyDuelTriggerOrderView(view!);
    copied.prompt.triggerIds.push("mutated-view-prompt");
    copied.groups[0]!.triggerBucket!.triggerIds.push("mutated-bucket");
    copied.groups[0]!.triggerOrderPrompt!.triggerIds.push("mutated-prompt");
    copied.groups[0]!.actions[0]!.label = "Mutated";

    expect(view!.prompt.triggerIds).toEqual(["first", "second"]);
    expect(view!.groups[0]!.triggerBucket!.triggerIds).toEqual(["first", "second"]);
    expect(view!.groups[0]!.triggerOrderPrompt!.triggerIds).toEqual(["first", "second"]);
    expect(view!.groups[0]!.actions[0]!.label).toBe("First");
  });

  it("deep-copies structured trigger-order prompt metadata for browser renderers", () => {
    const prompt: TriggerOrderPromptState = {
      id: "11:turnOptional:0",
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnOptional",
      triggerIds: ["first", "second"],
    };
    const group: DuelLegalActionGroup = {
      key: "11:triggerBucket:trigger-activate:turnOptional:0",
      label: "Trigger Activations",
      windowId: 11,
      windowKind: "triggerBucket",
      triggerBucket: { player: 0, triggerBucket: "turnOptional", triggerIds: ["first", "second"] },
      triggerOrderPrompt: prompt,
      actions: [
        { type: "activateTrigger", player: 0, triggerId: "first", triggerBucket: "turnOptional", uid: "a", effectId: "first-effect", label: "First" },
      ],
    };
    const view = duelTriggerOrderView(prompt, [group]);
    expect(view?.prompt).toEqual(prompt);

    view?.prompt.triggerIds.push("mutated");
    view?.groups[0]?.triggerBucket?.triggerIds.push("mutated-bucket");
    view?.groups[0]?.triggerOrderPrompt?.triggerIds.push("mutated-prompt");
    if (view?.groups[0]?.actions[0]) view.groups[0].actions[0].label = "Mutated";

    expect(prompt.triggerIds).toEqual(["first", "second"]);
    expect(group.triggerBucket?.triggerIds).toEqual(["first", "second"]);
    expect(group.triggerOrderPrompt?.triggerIds).toEqual(["first", "second"]);
    expect(group.actions[0]?.label).toBe("First");
  });
});
