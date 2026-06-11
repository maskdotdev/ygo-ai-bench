import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { getPromptResponseActions } from "#duel/prompt-response.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { resolvePendingLuaOperationPrompt, setPendingLuaOperationPrompt } from "#duel/lua-operation-prompt.js";
import { applyYieldedLuaPromptToDuelState, isYieldedLuaPromptCoroutineResult, resumeLuaPromptCoroutineWithDuelResponse, yieldedLuaPromptToDuelPrompt } from "#lua/prompt-state.js";

type SelectOptionResponse = Extract<DuelResponse, { type: "selectOption" }>;
type SelectYesNoResponse = Extract<DuelResponse, { type: "selectYesNo" }>;

const cards: DuelCardData[] = [
  { code: "100", name: "Top Card A", kind: "monster" },
  { code: "200", name: "Circle Hit A", kind: "monster" },
  { code: "300", name: "Circle Hit B", kind: "monster" },
  { code: "400", name: "Filler", kind: "monster" },
];

describe("Lua engine-driven selection prompts", () => {
  it("reveals, selects, and reorders cards for a Dark Magical Circle-style top-deck effect", () => {
    const session = createTopDeckSession();
    const host = createLuaScriptHost(session);
    const topUids = topDeckUids(session, 3);

    const first = host.runPromptCoroutine(
      `
      local g=Duel.GetDecktopGroup(0,3)
      Duel.ConfirmCards(0,g)
      if g:IsExists(function(c) return c:IsCode(200) or c:IsCode(300) end,1,nil) and Duel.SelectYesNo(0,472225360) then
        local sg=g:FilterSelect(0,function(c) return c:IsCode(200) or c:IsCode(300) end,1,1,nil)
        Duel.SendtoHand(sg,nil,REASON_EFFECT)
        Duel.SortDecktop(0,0,2)
      else
        Duel.SortDecktop(0,0,3)
      end
      `,
      "dark-magical-circle-style-selection.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SelectYesNo prompt");
    expect(first.prompt).toMatchObject({ api: "SelectYesNo", player: 0, description: 472225360, revealedUids: topUids });

    const second = resumeLuaPromptCoroutineWithDuelResponse(first, yesResponse(first, 0));
    expect(isYieldedLuaPromptCoroutineResult(second)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(second)) throw new Error("Expected SelectCard prompt");
    expect(second.prompt).toMatchObject({
      api: "SelectCard",
      player: 0,
      descriptions: [200, 300],
      revealedUids: topUids,
    });

    const selected300 = optionForUid(second, uidByCode(session, "300"));
    const third = resumeLuaPromptCoroutineWithDuelResponse(second, optionResponse(second, selected300));
    expect(isYieldedLuaPromptCoroutineResult(third)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(third)) throw new Error("Expected SortDecktop prompt");
    expect(third.prompt).toMatchObject({
      api: "SortDecktop",
      player: 0,
      descriptionLists: [[100, 200], [200, 100]],
      revealedUids: [uidByCode(session, "100"), uidByCode(session, "200")],
    });

    const order200Then100 = optionForSortOrder(third, [uidByCode(session, "200"), uidByCode(session, "100")]);
    const completed = resumeLuaPromptCoroutineWithDuelResponse(third, optionResponse(third, order200Then100));
    expect(completed).toMatchObject({ status: "completed" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "hand", controller: 0 });
    expect(topDeckCodes(session, 2)).toEqual(["200", "100"]);
  });

  it("still reveals and orders the checked cards when no card is eligible", () => {
    const session = createTopDeckSession();
    const host = createLuaScriptHost(session);
    const topUids = topDeckUids(session, 3);

    const first = host.runPromptCoroutine(
      `
      local g=Duel.GetDecktopGroup(0,3)
      Duel.ConfirmCards(0,g)
      if g:IsExists(function(c) return c:IsCode(999) end,1,nil) then
        local sg=g:FilterSelect(0,function(c) return c:IsCode(999) end,1,1,nil)
        Duel.SendtoHand(sg,nil,REASON_EFFECT)
        Duel.SortDecktop(0,0,2)
      else
        Duel.SortDecktop(0,0,3)
      end
      `,
      "dark-magical-circle-style-no-hit.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SortDecktop prompt");
    expect(first.prompt).toMatchObject({
      api: "SortDecktop",
      player: 0,
      revealedUids: topUids,
    });
    if (!("descriptionLists" in first.prompt)) throw new Error("Expected order choices");
    expect(first.prompt.descriptionLists).toContainEqual([300, 200, 100]);

    const reverseOrder = optionForSortOrder(first, [uidByCode(session, "300"), uidByCode(session, "200"), uidByCode(session, "100")]);
    const completed = resumeLuaPromptCoroutineWithDuelResponse(first, optionResponse(first, reverseOrder));
    expect(completed).toMatchObject({ status: "completed" });
    expect(topDeckCodes(session, 3)).toEqual(["300", "200", "100"]);
  });

  it("prompts real choices for generic Duel.SelectMatchingCard deck searches", () => {
    const session = createTopDeckSession();
    const host = createLuaScriptHost(session);

    const first = host.runPromptCoroutine(
      `
      local g=Duel.SelectMatchingCard(0,function(c) return c:IsCode(200) or c:IsCode(300) end,0,LOCATION_DECK,0,1,1,nil)
      local tc=g:GetFirst()
      return tc and tc:GetCode() or 0
      `,
      "select-matching-card-search.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SelectCard prompt");
    expect(first.prompt).toMatchObject({
      api: "SelectCard",
      player: 0,
      descriptions: [200, 300],
      revealedUids: [uidByCode(session, "200"), uidByCode(session, "300")],
    });

    const selected200 = optionForUid(first, uidByCode(session, "200"));
    expect(resumeLuaPromptCoroutineWithDuelResponse(first, optionResponse(first, selected200))).toEqual({ status: "completed", values: [200] });
  });

  it("keeps Lua operation metadata when one resolving effect yields multiple prompts", () => {
    const session = createTopDeckSession();
    const host = createLuaScriptHost(session);
    const topUids = topDeckUids(session, 3);
    let completed = false;

    const first = host.runPromptCoroutine(
      `
      local g=Duel.GetDecktopGroup(0,3)
      Duel.ConfirmCards(0,g)
      if Duel.SelectYesNo(0,472225360) then
        local sg=g:FilterSelect(0,function(c) return c:IsCode(200) or c:IsCode(300) end,1,1,nil)
      end
      `,
      "multi-yield-lua-operation.lua",
    );

    expect(isYieldedLuaPromptCoroutineResult(first)).toBe(true);
    if (!isYieldedLuaPromptCoroutineResult(first)) throw new Error("Expected SelectYesNo prompt");
    applyYieldedLuaPromptToDuelState(session.state, first, 0);
    session.state.luaOperationPrompt = {
      chainLink: { id: "chain-1", player: 0, sourceUid: topUids[0]!, effectId: "lua-1" },
      prompt: first.prompt,
    };
    setPendingLuaOperationPrompt(session.state, first, () => {
      completed = true;
    });

    expect(resolvePendingLuaOperationPrompt(session.state, yesResponse(first, 0))).toBe(true);
    expect(completed).toBe(false);
    expect(session.state.luaOperationPrompt?.prompt).toMatchObject({
      api: "SelectCard",
      player: 0,
      revealedUids: topUids,
    });
  });
});

function createTopDeckSession() {
  const session = createDuel({ seed: 47222536, startingHandSize: 0, drawPerTurn: 0, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["100", "200", "300", "400"] }, 1: { main: [] } });
  startDuel(session);
  for (const [sequence, code] of ["100", "200", "300", "400"].entries()) {
    const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.code === code);
    if (card) card.sequence = sequence;
  }
  return session;
}

function topDeckUids(session: ReturnType<typeof createTopDeckSession>, count: number): string[] {
  return session.state.cards
    .filter((card) => card.controller === 0 && card.location === "deck")
    .sort((left, right) => left.sequence - right.sequence)
    .slice(0, count)
    .map((card) => card.uid);
}

function topDeckCodes(session: ReturnType<typeof createTopDeckSession>, count: number): string[] {
  return session.state.cards
    .filter((card) => card.controller === 0 && card.location === "deck")
    .sort((left, right) => left.sequence - right.sequence)
    .slice(0, count)
    .map((card) => card.code);
}

function uidByCode(session: ReturnType<typeof createTopDeckSession>, code: string): string {
  const uid = session.state.cards.find((card) => card.code === code)?.uid;
  if (!uid) throw new Error(`Missing card ${code}`);
  return uid;
}

function yesResponse(yielded: Extract<ReturnType<ReturnType<typeof createLuaScriptHost>["runPromptCoroutine"]>, { status: "yielded" }>, player: 0 | 1): SelectYesNoResponse {
  const prompt = yieldedLuaPromptToDuelPrompt(yielded);
  const response = getPromptResponseActions(prompt!, player).find((action): action is SelectYesNoResponse => action.type === "selectYesNo" && action.yes);
  if (!response) throw new Error("Missing Yes response");
  return response;
}

function optionResponse(yielded: Extract<ReturnType<ReturnType<typeof createLuaScriptHost>["runPromptCoroutine"]>, { status: "yielded" }>, option: number): SelectOptionResponse {
  const prompt = yieldedLuaPromptToDuelPrompt(yielded);
  const response = getPromptResponseActions(prompt!, 0).find((action): action is SelectOptionResponse => action.type === "selectOption" && action.option === option);
  if (!response) throw new Error(`Missing option ${option}`);
  return response;
}

function optionForUid(yielded: Extract<ReturnType<ReturnType<typeof createLuaScriptHost>["runPromptCoroutine"]>, { status: "yielded" }>, uid: string): number {
  if (!("returnValues" in yielded.prompt) || yielded.prompt.returnValues === undefined) throw new Error("Prompt has no return values");
  const index = yielded.prompt.returnValues.findIndex((values) => values.some((value) => typeof value === "object" && value !== null && "uids" in value && value.uids.includes(uid)));
  const option = yielded.prompt.options[index];
  if (option === undefined) throw new Error(`Missing option for uid ${uid}`);
  return option;
}

function optionForSortOrder(yielded: Extract<ReturnType<ReturnType<typeof createLuaScriptHost>["runPromptCoroutine"]>, { status: "yielded" }>, uids: string[]): number {
  if (!("returnValues" in yielded.prompt) || yielded.prompt.returnValues === undefined) throw new Error("Prompt has no return values");
  const index = yielded.prompt.returnValues.findIndex((values) => values.some((value) => (
    typeof value === "object" &&
    value !== null &&
    "sortDeck" in value &&
    value.sortDeck.uids.length === uids.length &&
    value.sortDeck.uids.every((uid, uidIndex) => uid === uids[uidIndex])
  )));
  const option = yielded.prompt.options[index];
  if (option === undefined) throw new Error(`Missing option for order ${uids.join(",")}`);
  return option;
}
