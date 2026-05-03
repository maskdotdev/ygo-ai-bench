import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, restoreDuel, sendDuelCardToGraveyard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua state helpers", () => {
  it("lets Lua scripts read starting hand and draw counts", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Count Probe", kind: "monster" }];
    const session = createDuel({ seed: 165, startingHandSize: 3, drawPerTurn: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "100", "100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("hand draw counts " .. Duel.GetStartingHand(0) .. "/" .. Duel.GetDrawCount(0))
      `,
      "hand-draw-counts.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("hand draw counts 3/2");

    const defaultSession = createDuel({ seed: 166, cardReader: createCardReader(cards) });
    loadDecks(defaultSession, {
      0: { main: ["100", "100", "100", "100", "100"] },
      1: { main: [] },
    });
    startDuel(defaultSession);
    const defaultHost = createLuaScriptHost(defaultSession);
    const defaultResult = defaultHost.loadScript(
      `
      Debug.Message("default hand draw counts " .. Duel.GetStartingHand() .. "/" .. Duel.GetDrawCount())
      `,
      "default-hand-draw-counts.lua",
    );

    expect(defaultResult.ok, defaultResult.error).toBe(true);
    expect(defaultHost.messages).toContain("default hand draw counts 5/1");
  });

  it("lets Lua scripts set and clear custom card status bits", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Status Probe", kind: "monster" }];
    const session = createDuel({ seed: 166, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const card = session.state.cards.find((candidate) => candidate.code === "100");
    expect(card).toBeDefined();
    moveDuelCard(session.state, card!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("custom status before " .. tostring(c:IsStatus(STATUS_NO_LEVEL)) .. "/" .. tostring(c:IsStatus(STATUS_DESTROY_CONFIRMED)))
      c:SetStatus(STATUS_NO_LEVEL+STATUS_DESTROY_CONFIRMED,true)
      Debug.Message("custom status set " .. tostring(c:IsStatus(STATUS_NO_LEVEL)) .. "/" .. tostring(c:IsStatus(STATUS_DESTROY_CONFIRMED)))
      c:SetStatus(STATUS_DESTROY_CONFIRMED,false)
      Debug.Message("custom status cleared " .. tostring(c:IsStatus(STATUS_NO_LEVEL)) .. "/" .. tostring(c:IsStatus(STATUS_DESTROY_CONFIRMED)))
      `,
      "custom-status.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["custom status before true/false", "custom status set true/true", "custom status cleared true/false"]);
    expect(card!.customStatusMask).toBe(0x20);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.cards.find((candidate) => candidate.uid === card!.uid)?.customStatusMask).toBe(0x20);
  });

  it("lets Lua scripts store card turn counters", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Turn Counter Probe", kind: "spell" }];
    const session = createDuel({ seed: 167, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const card = session.state.cards.find((candidate) => candidate.code === "100");
    expect(card).toBeDefined();
    moveDuelCard(session.state, card!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("turn counter before " .. c:GetTurnCounter())
      c:SetTurnCounter(2)
      Debug.Message("turn counter set " .. c:GetTurnCounter())
      c:SetTurnCounter(-3)
      Debug.Message("turn counter clamped " .. c:GetTurnCounter())
      `,
      "turn-counter.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["turn counter before 0", "turn counter set 2", "turn counter clamped 0"]);
    expect(card!.turnCounter).toBe(0);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.cards.find((candidate) => candidate.uid === card!.uid)?.turnCounter).toBe(0);
  });

  it("lets Lua scripts apply drawless startup adjustments", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Drawless One", kind: "monster" },
      { code: "200", name: "Drawless Two", kind: "monster" },
    ];
    const session = createDuel({ seed: 167, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "100", "200", "100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local first = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local second = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e = { reset=false, Reset=function(self) self.reset=true end }
      aux.AddDrawless(first, true)
      aux.AddDrawless(second, 2)
      Debug.Message("drawless entries " .. tostring(aux.Drawless[first]) .. "/" .. tostring(aux.Drawless[second]))
      aux.drawlessop(e)
      Debug.Message("drawless adjusted " .. Duel.GetStartingHand(0) .. "/" .. tostring(e.reset))
      `,
      "drawless-startup.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("drawless entries 1/2");
    expect(host.messages).toContain("drawless adjusted 2/true");
  });

  it("lets Lua scripts register LP0 activation validity markers", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "LP0 Marker", kind: "trap" }];
    const session = createDuel({ seed: 168, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_LP0 or 511002521)
      aux.LP0ActivationValidity(e)
      Debug.Message("lp0 activatable " .. tostring(e:IsActivatable(0)))
      Debug.Message("lp0 markers " .. tostring(Duel.IsPlayerAffectedByEffect(0,511000793)~=nil) .. "/" .. tostring(Duel.IsPlayerAffectedByEffect(1,511000793)~=nil))
      `,
      "lp0-activation-validity.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("lp0 activatable true");
    expect(host.messages).toContain("lp0 markers true/true");
  });

  it("lets Lua scripts check skill activation timing", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Skill Probe", kind: "monster" }];
    const session = createDuel({ seed: 169, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const mainResult = host.loadScript(
      `
      Debug.Message("skill main " .. tostring(aux.CanActivateSkill(0)) .. "/" .. tostring(Auxiliary.CanActivateSkill(0)) .. "/" .. tostring(aux.CanActivateSkill(1)))
      `,
      "skill-main.lua",
    );
    expect(mainResult.ok, mainResult.error).toBe(true);

    session.state.phase = "battle";
    const battleResult = host.loadScript(
      `
      Debug.Message("skill battle " .. tostring(aux.CanActivateSkill(0)))
      `,
      "skill-battle.lua",
    );

    expect(battleResult.ok, battleResult.error).toBe(true);
    expect(host.messages).toContain("skill main true/true/false");
    expect(host.messages).toContain("skill battle false");
  });

  it("lets Lua scripts skip the next matching phase", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Phase Source", kind: "monster" }];
    const session = createDuel({ seed: 142, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.SkipPhase(0, PHASE_BATTLE, RESET_PHASE + PHASE_END, 1)
      Debug.Message("skip registered " .. Duel.GetTurnPlayer())
      `,
      "skip-phase.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("skip registered 0");
    expect(session.state.skippedPhases).toEqual([{ player: 0, phase: "battle", remaining: 1 }]);

    const next = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase");
    expect(next).toMatchObject({ phase: "main2" });
    expect(applyResponse(session, next!).ok).toBe(true);
    expect(session.state.phase).toBe("main2");
    expect(session.state.skippedPhases).toEqual([]);
  });

  it("lets Lua scripts query whether the turn player can enter battle phase", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Battle Phase Probe", kind: "monster" }];
    const session = createDuel({ seed: 151, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const main = host.loadScript(
      `
      Debug.Message("able main " .. tostring(Duel.IsAbleToEnterBP()))
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("piercing main " .. tostring(c:CanGetPiercingRush()))
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_CANNOT_ATTACK)
      e:SetRange(LOCATION_HAND)
      c:RegisterEffect(e)
      Debug.Message("piercing blocked " .. tostring(c:CanGetPiercingRush()))
      Debug.Message("continuous rush before " .. tostring(c:HasContinuousRushEffect()))
      c:RegisterFlagEffect(160015036, RESET_EVENT, 0, 1)
      Debug.Message("continuous rush after " .. tostring(c:HasContinuousRushEffect()))
      c:NegateContinuousRushEffects(RESETS_STANDARD_PHASE_END)
      Debug.Message("continuous rush negated " .. c:GetFlagEffect(160015136))
      Duel.SkipPhase(0, PHASE_BATTLE, RESET_PHASE + PHASE_END, 1)
      Debug.Message("able skipped " .. tostring(Duel.IsAbleToEnterBP()))
      Debug.Message("piercing skipped " .. tostring(c:CanGetPiercingRush()))
      `,
      "battle-phase-able-main.lua",
    );

    expect(main.ok, main.error).toBe(true);
    expect(host.messages).toContain("able main true");
    expect(host.messages).toContain("piercing main true");
    expect(host.messages).toContain("piercing blocked false");
    expect(host.messages).toContain("continuous rush before false");
    expect(host.messages).toContain("continuous rush after true");
    expect(host.messages).toContain("continuous rush negated 1");
    expect(host.messages).toContain("able skipped false");
    expect(host.messages).toContain("piercing skipped false");

    const next = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase");
    expect(next).toMatchObject({ phase: "main2" });
    expect(applyResponse(session, next!).ok).toBe(true);

    const after = host.loadScript(
      `
      Debug.Message("able main2 " .. tostring(Duel.IsAbleToEnterBP()))
      Debug.Message("is main phase 2 " .. tostring(Duel.IsMainPhase2()))
      `,
      "battle-phase-able-main2.lua",
    );

    expect(after.ok, after.error).toBe(true);
    expect(host.messages).toContain("able main2 false");
    expect(host.messages).toContain("is main phase 2 true");
  });

  it.each([
    { code: 183, label: "skip" },
    { code: 185, label: "cannot" },
  ])("lets Lua battle-phase entry queries respect continuous $label locks", ({ code, label }) => {
    const cards: DuelCardData[] = [{ code: "100", name: "Battle Phase Lock", kind: "monster" }];
    const session = createDuel({ seed: 152, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).position = "faceUpAttack";
    registerEffect(session, {
      id: `lua-${label}-battle-phase`,
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code,
      range: ["monsterZone"],
      operation() {},
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("able continuous locked " .. tostring(Duel.IsAbleToEnterBP()))
      `,
      `battle-phase-continuous-${label}-lock.lua`,
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("able continuous locked false");
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "changePhase" && action.phase === "battle")).toBe(false);
  });

  it("lets Lua scripts query current phase helper predicates", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Phase Predicate Probe", kind: "monster" }];
    const session = createDuel({ seed: 167, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);

    session.state.phase = "draw";
    let result = host.loadScript(
      `
      Debug.Message("phase draw " .. tostring(Duel.IsDrawPhase()) .. "/" .. tostring(Duel.IsDrawPhase(0)) .. "/" .. tostring(Duel.IsDrawPhase(1)) .. "/" .. tostring(Duel.IsStandbyPhase()))
      `,
      "phase-predicate-draw.lua",
    );
    expect(result.ok, result.error).toBe(true);

    session.state.phase = "standby";
    result = host.loadScript(
      `
      Debug.Message("phase standby " .. tostring(Duel.IsStandbyPhase()) .. "/" .. tostring(Duel.IsDrawPhase()))
      `,
      "phase-predicate-standby.lua",
    );
    expect(result.ok, result.error).toBe(true);

    session.state.phase = "main1";
    result = host.loadScript(
      `
      Debug.Message("phase main1 " .. tostring(Duel.IsMainPhase1()) .. "/" .. tostring(Duel.IsMainPhase()) .. "/" .. tostring(Duel.IsMainPhase2()))
      `,
      "phase-predicate-main1.lua",
    );
    expect(result.ok, result.error).toBe(true);

    session.state.phase = "battle";
    session.state.battleStep = "attack";
    result = host.loadScript(
      `
      Debug.Message("phase battle step " .. tostring(Duel.IsBattleStep()) .. "/" .. tostring(Duel.IsStartOfBattlePhase()) .. "/" .. tostring(Duel.IsStartStep()) .. "/" .. tostring(Duel.IsEndOfBattlePhase()) .. "/" .. tostring(Duel.IsBattlePhase()))
      `,
      "phase-predicate-battle-step.lua",
    );
    expect(result.ok, result.error).toBe(true);

    delete session.state.battleStep;
    result = host.loadScript(
      `
      Debug.Message("phase battle start " .. tostring(Duel.IsBattleStep()) .. "/" .. tostring(Duel.IsStartOfBattlePhase()) .. "/" .. tostring(Duel.IsStartStep()) .. "/" .. tostring(Duel.IsEndOfBattlePhase()))
      `,
      "phase-predicate-battle-start.lua",
    );
    expect(result.ok, result.error).toBe(true);

    session.state.attacksDeclared.push("attacked-card");
    result = host.loadScript(
      `
      Debug.Message("phase battle end " .. tostring(Duel.IsBattleStep()) .. "/" .. tostring(Duel.IsStartOfBattlePhase()) .. "/" .. tostring(Duel.IsStartStep()) .. "/" .. tostring(Duel.IsEndOfBattlePhase()))
      `,
      "phase-predicate-battle-end.lua",
    );
    expect(result.ok, result.error).toBe(true);

    session.state.phase = "end";
    result = host.loadScript(
      `
      Debug.Message("phase end " .. tostring(Duel.IsEndPhase()) .. "/" .. tostring(Duel.IsEndPhase(0)) .. "/" .. tostring(Duel.IsEndPhase(1)))
      `,
      "phase-predicate-end.lua",
    );
    expect(result.ok, result.error).toBe(true);

    expect(host.messages).toContain("phase draw true/true/false/false");
    expect(host.messages).toContain("phase standby true/false");
    expect(host.messages).toContain("phase main1 true/true/false");
    expect(host.messages).toContain("phase battle step true/false/false/false/true");
    expect(host.messages).toContain("phase battle start false/true/true/true");
    expect(host.messages).toContain("phase battle end false/false/false/true");
    expect(host.messages).toContain("phase end true/true/false");
  });

});
