import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, sendDuelCardToGraveyard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua state helpers", () => {
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
      Duel.SkipPhase(0, PHASE_BATTLE, RESET_PHASE + PHASE_END, 1)
      Debug.Message("able skipped " .. tostring(Duel.IsAbleToEnterBP()))
      `,
      "battle-phase-able-main.lua",
    );

    expect(main.ok, main.error).toBe(true);
    expect(host.messages).toContain("able main true");
    expect(host.messages).toContain("able skipped false");

    const next = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase");
    expect(next).toMatchObject({ phase: "main2" });
    expect(applyResponse(session, next!).ok).toBe(true);

    const after = host.loadScript(
      `
      Debug.Message("able main2 " .. tostring(Duel.IsAbleToEnterBP()))
      `,
      "battle-phase-able-main2.lua",
    );

    expect(after.ok, after.error).toBe(true);
    expect(host.messages).toContain("able main2 false");
  });

  it("lets Lua scripts raise events for trigger effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Raised Event Card", kind: "monster" },
      { code: "200", name: "Raised Event Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 143, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const register = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("raised trigger " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "raise-event-register.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(target, EVENT_TO_GRAVE, nil, REASON_EFFECT, 0, 0, 0)
      `,
      "raise-event.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCardUid: session.state.cards.find((card) => card.code === "100")?.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("raised trigger 100");
  });

  it("lets Lua scripts raise single-card events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Single Event First", kind: "monster" },
      { code: "101", name: "Single Event Second", kind: "monster" },
      { code: "200", name: "Single Event Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 146, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "101", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const register = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("single trigger " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "raise-single-event-register.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 101), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.RaiseSingleEvent(target, EVENT_TO_GRAVE, nil, REASON_EFFECT, 0, 0, 0)
      Debug.Message("single check " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)))
      `,
      "raise-single-event.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const raisedUid = session.state.cards.find((card) => card.code === "101")?.uid;
    expect(session.state.eventHistory).toContainEqual({ eventName: "sentToGraveyard", eventCardUid: raisedUid });
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCardUid: raisedUid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("single check true");
    expect(host.messages).toContain("single trigger 101");
  });

  it("lets Lua scripts check recorded duel events", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Checked Event Card", kind: "monster" }];
    const session = createDuel({ seed: 144, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("check before " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)))
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(target, EVENT_TO_GRAVE, nil, REASON_EFFECT, 0, 0, 0)
      Debug.Message("check raised " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)))
      `,
      "check-event-raised.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("check before false");
    expect(host.messages).toContain("check raised true");
    expect(session.state.eventHistory).toContainEqual({ eventName: "sentToGraveyard", eventCardUid: session.state.cards.find((card) => card.code === "100")?.uid });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const restoredHost = createLuaScriptHost(restored);
    const restoredResult = restoredHost.loadScript(
      `
      Debug.Message("check restored " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)))
      `,
      "check-event-restored.lua",
    );

    expect(restoredResult.ok, restoredResult.error).toBe(true);
    expect(restoredHost.messages).toContain("check restored true");
  });

  it("records engine movement events for Lua event checks", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Moved Event Card", kind: "monster" }];
    const session = createDuel({ seed: 145, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Duel.SendtoGrave(target, REASON_EFFECT)
      Debug.Message("check moved " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)))
      `,
      "check-event-moved.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("check moved true");
  });

  it("lets Lua scripts query a card's summon player", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Player Normal", kind: "monster" },
      { code: "200", name: "Summon Player Special", kind: "monster" },
      { code: "300", name: "Summon Player Unsummoned", kind: "monster" },
    ];
    const session = createDuel({ seed: 147, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const normal = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const special = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    const unsummoned = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(normal).toBeTruthy();
    expect(special).toBeTruthy();
    expect(unsummoned).toBeTruthy();

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon player unsummoned " .. tostring(c:IsSummonPlayer(0)) .. "/" .. tostring(c:IsSummonPlayer(1)))
      `,
      "summon-player-before.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("summon player unsummoned false/false");

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === normal!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    specialSummonDuelCard(session.state, special!.uid, 1);

    const after = host.loadScript(
      `
      local normal=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local special=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon player normal " .. tostring(normal:IsSummonPlayer(0)) .. "/" .. tostring(normal:IsSummonPlayer(1)))
      Debug.Message("summon player special " .. tostring(special:IsSummonPlayer(0)) .. "/" .. tostring(special:IsSummonPlayer(1)))
      `,
      "summon-player-after.lua",
    );
    expect(after.ok, after.error).toBe(true);
    expect(session.state.cards.find((card) => card.uid === normal!.uid)?.summonPlayer).toBe(0);
    expect(session.state.cards.find((card) => card.uid === special!.uid)?.summonPlayer).toBe(1);
    expect(host.messages).toContain("summon player normal true/false");
    expect(host.messages).toContain("summon player special false/true");
  });

  it("lets Lua scripts query duel type flags and enable unofficial procedures", () => {
    const session = createDuel({ seed: 99, startingHandSize: 0, duelTypeFlags: 0x2000 + 0x4000 + 0x8000 + 0x1000000000 });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("duel type default " .. tostring(Duel.IsDuelType(DUEL_EMZONE)) .. "/" .. tostring(Duel.IsDuelType(DUEL_SEPARATE_PZONE)))
      Debug.Message("duel type high " .. tostring(Duel.IsDuelType(DUEL_NORMAL_SUMMON_FACEUP_DEF)))
      Debug.Message("deck master default " .. tostring(Duel.IsDeckMaster(0, 153000001)) .. "/" .. tostring(Duel.GetDeckMaster(0)==nil))
      Debug.Message("additional tribute default " .. tostring(Duel.IsPlayerCanAdditionalTributeSummon(0)))
      Duel.RegisterFlagEffect(0, 52112003, RESET_EVENT, 0, 1)
      Debug.Message("additional tribute flagged " .. tostring(Duel.IsPlayerCanAdditionalTributeSummon(0)))
      Duel.ResetFlagEffect(0, 52112003)
      Debug.Message("additional tribute reset " .. tostring(Duel.IsPlayerCanAdditionalTributeSummon(0)))
      Duel.EnableUnofficialProc()
      Duel.EnableGlobalFlag(GLOBALFLAG_DETACH_EVENT)
      Duel.EnableGlobalFlag(GLOBALFLAG_SELF_TOGRAVE)
      Debug.Message("unofficial enabled")
      `,
      "duel-type.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("duel type default true/false");
    expect(host.messages).toContain("duel type high true");
    expect(host.messages).toContain("deck master default false/true");
    expect(host.messages).toContain("additional tribute default true");
    expect(host.messages).toContain("additional tribute flagged false");
    expect(host.messages).toContain("additional tribute reset true");
    expect(host.messages).toContain("unofficial enabled");
    expect(session.state.unofficialProcEnabled).toBe(true);
    expect(session.state.globalFlags).toBe(0x10 | 0x100);
    expect(restoreDuel(serializeDuel(session)).state.unofficialProcEnabled).toBe(true);
    expect(restoreDuel(serializeDuel(session)).state.globalFlags).toBe(0x10 | 0x100);
  });

  it("lets Lua effects register, read, and reset duel and card flags", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Flag Source", kind: "monster" }];
    const session = createDuel({ seed: 22, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          Debug.Message("duel flag register " .. Duel.RegisterFlagEffect(0, 901, RESET_EVENT, 0, 3))
          Debug.Message("card flag register " .. c:RegisterFlagEffect(902, RESET_EVENT, 0, 4))
          Duel.RegisterFlagEffect(0, 903, RESET_EVENT, EFFECT_FLAG_REPEAT, 1)
          Duel.RegisterFlagEffect(0, 903, RESET_EVENT, EFFECT_FLAG_REPEAT, 1)
          c:RegisterFlagEffect(904, RESET_EVENT, EFFECT_FLAG_REPEAT, 1)
          c:RegisterFlagEffect(904, RESET_EVENT, EFFECT_FLAG_REPEAT, 1)
          Debug.Message("duel has flag " .. tostring(Duel.HasFlagEffect(0, 901)) .. "/" .. tostring(Duel.HasFlagEffect(0, 901, 2)) .. "/" .. tostring(Duel.HasFlagEffect(0, 903, 2)))
          Debug.Message("card has flag " .. tostring(c:HasFlagEffect(902)) .. "/" .. tostring(c:HasFlagEffect(902, 2)) .. "/" .. tostring(c:HasFlagEffect(904, 2)))
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag count " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag count " .. c:GetFlagEffect(902))
          Debug.Message("duel flag reset " .. Duel.ResetFlagEffect(0, 901))
          Debug.Message("card flag reset " .. c:ResetFlagEffect(902))
          Duel.ResetFlagEffect(0, 903)
          c:ResetFlagEffect(904)
          Debug.Message("duel flag after " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag after " .. c:GetFlagEffect(902))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-effects.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("duel flag register 1");
    expect(host.messages).toContain("card flag register 1");
    expect(host.messages).toContain("duel has flag true/false/true");
    expect(host.messages).toContain("card has flag true/false/true");
    expect(host.messages).toContain("duel flag count 1");
    expect(host.messages).toContain("card flag count 1");
    expect(host.messages).toContain("duel flag reset 1");
    expect(host.messages).toContain("card flag reset 1");
    expect(host.messages).toContain("duel flag after 0");
    expect(host.messages).toContain("card flag after 0");
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("expires Lua flag effects at chain reset boundaries", () => {
    const cards: DuelCardData[] = [{ code: "101", name: "Flag Chain Source", kind: "monster" }];
    const session = createDuel({ seed: 137, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101"] },
      1: { main: ["101"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c101={}
      function c101.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag chain " .. Duel.RegisterFlagEffect(0, 911, RESET_CHAIN, 0, 1))
          Debug.Message("card flag chain " .. c:RegisterFlagEffect(912, RESET_CHAIN, 0, 1))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-chain-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("duel flag chain 1");
    expect(host.messages).toContain("card flag chain 1");
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("expires Lua flag effects at phase and card movement reset boundaries", () => {
    const cards: DuelCardData[] = [{ code: "102", name: "Flag Phase Source", kind: "monster" }];
    const session = createDuel({ seed: 138, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["102"] },
      1: { main: ["102"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "102");
    expect(source).toBeDefined();
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c102={}
      function c102.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag phase " .. Duel.RegisterFlagEffect(0, 921, RESET_PHASE + PHASE_BATTLE, 0, 1))
          Debug.Message("card flag field " .. c:RegisterFlagEffect(922, RESET_EVENT + RESET_TOFIELD, 0, 1))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-phase-move-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(session.state.flagEffects).toHaveLength(2);

    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([921]);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    expect(applyResponse(session, battle!).ok).toBe(true);

    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("replaces non-repeat flag effects and exposes flag labels", () => {
    const cards: DuelCardData[] = [{ code: "103", name: "Flag Repeat Source", kind: "monster" }];
    const session = createDuel({ seed: 139, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["103"] },
      1: { main: ["103"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c103={}
      function c103.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag first " .. Duel.RegisterFlagEffect(0, 931, RESET_EVENT, 0, 11))
          Debug.Message("duel flag replace " .. Duel.RegisterFlagEffect(0, 931, RESET_EVENT, 0, 12))
          Debug.Message("duel flag label " .. Duel.GetFlagEffectLabel(0, 931))
          Debug.Message("duel flag repeat " .. Duel.RegisterFlagEffect(0, 931, RESET_EVENT, EFFECT_FLAG_REPEAT, 13))
          Debug.Message("duel flag repeat label " .. Duel.GetFlagEffectLabel(0, 931))
          Debug.Message("card flag first " .. c:RegisterFlagEffect(932, RESET_EVENT, 0, 21))
          Debug.Message("card flag replace " .. c:RegisterFlagEffect(932, RESET_EVENT, 0, 22))
          Debug.Message("card flag label " .. c:GetFlagEffectLabel(932))
          Debug.Message("card flag repeat " .. c:RegisterFlagEffect(932, RESET_EVENT, EFFECT_FLAG_REPEAT, 23))
          Debug.Message("card flag repeat label " .. c:GetFlagEffectLabel(932))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-repeat-labels.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toEqual(
      expect.arrayContaining([
        "duel flag first 1",
        "duel flag replace 1",
        "duel flag label 12",
        "duel flag repeat 2",
        "duel flag repeat label 12",
        "card flag first 1",
        "card flag replace 1",
        "card flag label 22",
        "card flag repeat 2",
        "card flag repeat label 22",
      ]),
    );
    expect(session.state.flagEffects.filter((flag) => flag.code === 931)).toHaveLength(2);
    expect(session.state.flagEffects.filter((flag) => flag.code === 932)).toHaveLength(2);
  });

  it("updates Lua flag effect labels", () => {
    const cards: DuelCardData[] = [{ code: "104", name: "Flag Label Source", kind: "monster" }];
    const session = createDuel({ seed: 140, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["104"] },
      1: { main: ["104"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c104={}
      function c104.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Duel.RegisterFlagEffect(0, 941, RESET_EVENT, 0, 31)
          c:RegisterFlagEffect(942, RESET_EVENT, 0, 41)
          Debug.Message("duel set label " .. Duel.SetFlagEffectLabel(0, 941, 32))
          Debug.Message("card set label " .. c:SetFlagEffectLabel(942, 42))
          Debug.Message("duel updated label " .. Duel.GetFlagEffectLabel(0, 941))
          Debug.Message("card updated label " .. c:GetFlagEffectLabel(942))
          Debug.Message("missing label " .. Duel.SetFlagEffectLabel(0, 999, 1) .. "/" .. c:SetFlagEffectLabel(999, 1))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-label-setters.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toEqual(
      expect.arrayContaining([
        "duel set label 1",
        "card set label 1",
        "duel updated label 32",
        "card updated label 42",
        "missing label 0/0",
      ]),
    );
  });

  it("uses the first repeated flag label and resets the whole repeated stack", () => {
    const cards: DuelCardData[] = [{ code: "105", name: "Flag Repeat Edge Source", kind: "monster" }];
    const session = createDuel({ seed: 141, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["105"] },
      1: { main: ["105"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c105={}
      function c105.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Duel.RegisterFlagEffect(0, 951, RESET_EVENT, EFFECT_FLAG_REPEAT, 51)
          Duel.RegisterFlagEffect(0, 951, RESET_EVENT, EFFECT_FLAG_REPEAT, 52)
          c:RegisterFlagEffect(952, RESET_EVENT, EFFECT_FLAG_REPEAT, 61)
          c:RegisterFlagEffect(952, RESET_EVENT, EFFECT_FLAG_REPEAT, 62)
          Debug.Message("duel repeated count " .. Duel.GetFlagEffect(0, 951))
          Debug.Message("card repeated count " .. c:GetFlagEffect(952))
          Debug.Message("duel repeated label " .. Duel.GetFlagEffectLabel(0, 951))
          Debug.Message("card repeated label " .. c:GetFlagEffectLabel(952))
          Debug.Message("duel repeated set " .. Duel.SetFlagEffectLabel(0, 951, 53))
          Debug.Message("card repeated set " .. c:SetFlagEffectLabel(952, 63))
          Debug.Message("duel repeated label after " .. Duel.GetFlagEffectLabel(0, 951))
          Debug.Message("card repeated label after " .. c:GetFlagEffectLabel(952))
          Debug.Message("duel repeated reset " .. Duel.ResetFlagEffect(0, 951))
          Debug.Message("card repeated reset " .. c:ResetFlagEffect(952))
          Debug.Message("duel repeated after " .. Duel.GetFlagEffect(0, 951))
          Debug.Message("card repeated after " .. c:GetFlagEffect(952))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-repeat-edge-labels.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toEqual(
      expect.arrayContaining([
        "duel repeated count 2",
        "card repeated count 2",
        "duel repeated label 51",
        "card repeated label 61",
        "duel repeated set 1",
        "card repeated set 1",
        "duel repeated label after 53",
        "card repeated label after 63",
        "duel repeated reset 2",
        "card repeated reset 2",
        "duel repeated after 0",
        "card repeated after 0",
      ]),
    );
    expect(session.state.flagEffects.filter((flag) => flag.code === 951 || flag.code === 952)).toHaveLength(0);
  });

  it("provides common aux compatibility helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Aux A", kind: "monster", attack: 1000 },
      { code: "200", name: "Aux B", kind: "monster", attack: 2000 },
      { code: "300", name: "Aux C", kind: "monster", attack: 3000 },
      { code: "400", name: "Aux D", kind: "monster", attack: 4000 },
      { code: "500", name: "Aux E", kind: "monster", attack: 5000 },
      { code: "94820406", name: "Dark Fusion", kind: "spell" },
      { code: "48130397", name: "Super Polymerization", kind: "spell" },
      { code: "59419719", name: "Fossil Fusion", kind: "spell" },
      { code: "900", name: "Fossil Target", kind: "extra" },
    ];
    const session = createDuel({ seed: 18, startingHandSize: 8, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "94820406", "48130397", "59419719"], extra: ["900"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const faceup = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const facedown = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const sameTurn = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const graveyard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "400");
    const darkFusion = session.state.cards.find((card) => card.controller === 0 && card.code === "94820406");
    const superPoly = session.state.cards.find((card) => card.controller === 0 && card.code === "48130397");
    const fossilFusion = session.state.cards.find((card) => card.controller === 0 && card.code === "59419719");
    moveDuelCard(session.state, faceup!.uid, "monsterZone", 0).position = "faceUpAttack";
    const setCard = moveDuelCard(session.state, facedown!.uid, "monsterZone", 0);
    setCard.position = "faceDownDefense";
    setCard.faceUp = false;
    sendDuelCardToGraveyard(session.state, sameTurn!.uid, 0, duelReason.effect);
    moveDuelCard(session.state, graveyard!.uid, "graveyard", 0);
    moveDuelCard(session.state, darkFusion!.uid, "graveyard", 0);
    moveDuelCard(session.state, superPoly!.uid, "graveyard", 0);
    moveDuelCard(session.state, fossilFusion!.uid, "graveyard", 0);
    graveyard!.turnId = 0;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_stringid = aux.Stringid(100, 2)
      Debug.Message("players count " .. Duel.GetPlayersCount(0) .. "/" .. Duel.GetPlayersCount(1))
      Debug.Message("true count " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      Debug.Message("false count " .. Duel.GetMatchingGroupCount(aux.FALSE, 0, LOCATION_HAND, 0, nil))
      local wrapped = aux.NecroValleyFilter(aux.FilterBoolFunction(Card.IsCode, 100))
      Debug.Message("wrapped count " .. Duel.GetMatchingGroupCount(wrapped, 0, LOCATION_HAND, 0, nil))
      local wrapped_ex = aux.FilterBoolFunctionEx(function(c, minatk, code) return c:GetAttack() >= minatk and c:IsCode(code) end, 1500)
      Debug.Message("wrapped ex count " .. Duel.GetMatchingGroupCount(wrapped_ex, 0, LOCATION_HAND, 0, nil, 300))
      local wrapped_ex2 = aux.FilterBoolFunctionEx2(function(c, scard, sumtype, tp, minatk, code) return tp==0 and sumtype==SUMMON_TYPE_FUSION and c:GetAttack() >= minatk and c:IsCode(code) end, 1500, 300)
      Debug.Message("wrapped ex2 " .. tostring(wrapped_ex2(Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst(), nil, SUMMON_TYPE_FUSION, 0)) .. "/" .. tostring(wrapped_ex2(Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst(), nil, SUMMON_TYPE_SYNCHRO, 0)))
      local target_bool = aux.TargetBoolFunction(function(c, minatk, code) return c:GetAttack() >= minatk and c:IsCode(code) end, 2500)
      Debug.Message("target bool count " .. Duel.GetMatchingGroupCount(target_bool, 0, LOCATION_HAND, 0, nil, 300))
      local faceup_filter = aux.FaceupFilter(function(c, minatk) return c:GetAttack() >= minatk end, 900)
      Debug.Message("faceup count " .. Duel.GetMatchingGroupCount(faceup_filter, 0, LOCATION_MZONE, 0, nil))
      Debug.Message("faceup runtime count " .. Duel.GetMatchingGroupCount(aux.FaceupFilter(function(c, minatk) return c:GetAttack() >= minatk end), 0, LOCATION_MZONE, 0, nil, 900))
      local faceup_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local facedown_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local necrovalley_effect=Effect.CreateEffect(faceup_monster)
      necrovalley_effect:SetType(EFFECT_TYPE_SINGLE)
      necrovalley_effect:SetCode(EFFECT_NECRO_VALLEY)
      faceup_monster:RegisterEffect(necrovalley_effect)
      Debug.Message("nvfilter " .. tostring(aux.nvfilter(faceup_monster)) .. "/" .. tostring(aux.nvfilter(facedown_monster)))
      local same_turn_grave = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local grave_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("sp elim grave " .. tostring(aux.SpElimFilter(grave_monster)))
      Debug.Message("is zone " .. tostring(aux.IsZone(faceup_monster,1,0)) .. "/" .. tostring(aux.IsZone(faceup_monster,2,0)) .. "/" .. tostring(aux.IsZone(faceup_monster,1<<16,1)))
      Debug.Message("sp elim faceup mzone " .. tostring(aux.SpElimFilter(faceup_monster, true)) .. "/" .. tostring(aux.SpElimFilter(faceup_monster, true, true)))
      Debug.Message("sp elim facedown mzone " .. tostring(aux.SpElimFilter(facedown_monster, true, true)) .. "/" .. tostring(aux.SpElimFilter(facedown_monster, false, true)))
      Debug.Message("maximum defaults " .. tostring(faceup_monster:IsMaximumMode()) .. "/" .. tostring(faceup_monster:IsMaximumModeCenter()) .. "/" .. tostring(faceup_monster:IsMaximumModeSide()) .. "/" .. tostring(faceup_monster:IsNotMaximumModeSide()))
      local maximum_wrapped = aux.FilterMaximumSideFunctionEx(function(c,minatk) return c:IsFaceup() and c:GetAttack() >= minatk end, 900)
      Debug.Message("maximum ex count " .. Duel.GetMatchingGroupCount(maximum_wrapped, 0, LOCATION_MZONE, 0, nil))
      Debug.Message("maximum side count " .. Duel.GetMatchingGroupCount(aux.FilterMaximumSideFunction(function(c) return c:IsFaceup() end), 0, LOCATION_MZONE, 0, nil))
      Debug.Message("not count " .. Duel.GetMatchingGroupCount(aux.NOT(Card.IsCode), 0, LOCATION_HAND, 0, nil, 100))
      Debug.Message("and count " .. Duel.GetMatchingGroupCount(aux.AND(Card.IsFaceup, Card.IsAttackAbove), 0, LOCATION_MZONE, 0, nil, 900))
      Debug.Message("or count " .. Duel.GetMatchingGroupCount(aux.OR(Card.IsFacedown, Card.IsAttackAbove), 0, LOCATION_MZONE, 0, nil, 900))
      Debug.Message("coin hint " .. aux.GetCoinEffectHintString(COIN_HEADS) .. "/" .. aux.GetCoinEffectHintString(COIN_TAILS) .. "/" .. tostring(aux.GetCoinEffectHintString(9)))
      local field_tg = aux.FieldSummonProcTg(function(e,tp) return tp==0 end,function(e,tp,eg,ep,ev,re,r,rp,chk,c,minatk) return c:GetAttack()>=minatk end)
      Debug.Message("field summon tg " .. tostring(field_tg(nil,0,Group.CreateGroup(),0,0,nil,0,0,0,nil)) .. "/" .. tostring(field_tg(nil,1,Group.CreateGroup(),0,0,nil,0,0,0,nil)) .. "/" .. tostring(field_tg(nil,0,Group.CreateGroup(),0,0,nil,0,0,0,faceup_monster,900)) .. "/" .. tostring(field_tg(nil,0,Group.CreateGroup(),0,0,nil,0,0,0,faceup_monster,2000)))
      local reset_count=0
      local reset_effect=aux.AddValuesReset(function() reset_count=reset_count+1 end)
      local reset_second=aux.AddValuesReset(function() reset_count=reset_count+10 end)
      Debug.Message("values reset setup " .. reset_effect:GetCode() .. "/" .. reset_effect:GetCountLimit() .. "/" .. tostring(reset_second==nil))
      Debug.Message("values reset call " .. tostring(aux.ValuesReset()) .. "/" .. reset_count)
      local gate_low=Effect.CreateEffect(faceup_monster)
      gate_low:SetType(EFFECT_TYPE_FIELD)
      gate_low:SetCode(CARD_SUMMON_GATE)
      gate_low:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      gate_low:SetTargetRange(1,0)
      gate_low:SetValue(2)
      Duel.RegisterEffect(gate_low,0)
      local gate_high=Effect.CreateEffect(faceup_monster)
      gate_high:SetType(EFFECT_TYPE_FIELD)
      gate_high:SetCode(CARD_SUMMON_GATE)
      gate_high:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      gate_high:SetTargetRange(1,0)
      gate_high:SetValue(function(tp) return tp==0 and 4 or 1 end)
      Duel.RegisterEffect(gate_high,0)
      Debug.Message("summon gate " .. tostring(aux.CheckSummonGate(0)) .. "/" .. tostring(aux.CheckSummonGate(0,2)) .. "/" .. tostring(aux.CheckSummonGate(0,3)) .. "/" .. tostring(aux.CheckSummonGate(1)) .. "/" .. tostring(aux.CheckSummonGate(1,3)))
      local named = aux.FunctionWithNamedArgs(function(a,b,...)
        local total=0
        for _,value in ipairs({...}) do total=total+value end
        return a .. "/" .. b .. "/" .. total
      end, "first", {"missing","fallback"}, "vaargs")
      Debug.Message("named args " .. named({first="A",fallback="B",vaargs={3,4}}) .. "/" .. named("X","Y",5,6))
      local mat_filter = aux.cannotmatfilter(SUMMON_TYPE_FUSION,SUMMON_TYPE_SYNCHRO)
      local table_mat_filter = aux.cannotmatfilter({SUMMON_TYPE_XYZ,SUMMON_TYPE_LINK})
      Debug.Message("cannot mat " .. tostring(mat_filter(nil,nil,SUMMON_TYPE_FUSION,0)) .. "/" .. tostring(mat_filter(nil,nil,SUMMON_TYPE_XYZ,0)) .. "/" .. tostring(table_mat_filter(nil,nil,SUMMON_TYPE_LINK,0)))
      Debug.Message("chkf mmz " .. tostring(aux.ChkfMMZ(1)(Group.CreateGroup(), nil, 0)) .. "/" .. tostring(aux.ChkfMMZ(6)(Group.CreateGroup(), nil, 0)))
      Debug.Message("ritlimit " .. tostring(aux.ritlimit(nil,nil,0,SUMMON_TYPE_RITUAL)) .. "/" .. tostring(aux.ritlimit(nil,nil,0,SUMMON_TYPE_FUSION)))
      local value_effect=Effect.CreateEffect(faceup_monster)
      Debug.Message("value helpers own " .. tostring(aux.tgoval(value_effect,nil,0)) .. "/" .. tostring(aux.indsval(value_effect,nil,0)) .. "/" .. tostring(aux.indoval(value_effect,nil,0)))
      Debug.Message("value helpers opponent " .. tostring(aux.tgoval(value_effect,nil,1)) .. "/" .. tostring(aux.indsval(value_effect,nil,1)) .. "/" .. tostring(aux.indoval(value_effect,nil,1)))
      local opponent_card = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local dark_fusion = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 94820406), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local super_poly = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 48130397), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local fossil_fusion = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 59419719), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local fossil_target = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      Debug.Message("imval helpers " .. tostring(aux.imval1(value_effect,faceup_monster)) .. "/" .. tostring(aux.imval2(value_effect,faceup_monster)) .. "/" .. tostring(aux.imval2(value_effect,opponent_card)))
      aux.chainreg(value_effect,0,Group.CreateGroup(),0,0,nil,0,0)
      aux.chainreg(value_effect,0,Group.CreateGroup(),0,0,nil,0,0)
      Debug.Message("chainreg flag " .. faceup_monster:GetFlagEffect(1))
      value_effect:SetLabel(100)
      aux.sumreg(value_effect,0,Group.FromCards(faceup_monster,opponent_card),0,0,nil,0,0)
      Debug.Message("sumreg flags " .. faceup_monster:GetFlagEffect(100) .. "/" .. opponent_card:GetFlagEffect(100))
      Debug.Message("extra limits " .. tostring(aux.fuslimit(nil,nil,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.synlimit(nil,nil,0,SUMMON_TYPE_SYNCHRO)) .. "/" .. tostring(aux.xyzlimit(nil,nil,0,SUMMON_TYPE_XYZ)))
      Debug.Message("extra misses " .. tostring(aux.fuslimit(nil,nil,0,SUMMON_TYPE_SYNCHRO)) .. "/" .. tostring(aux.synlimit(nil,nil,0,SUMMON_TYPE_XYZ)) .. "/" .. tostring(aux.xyzlimit(nil,nil,0,SUMMON_TYPE_FUSION)))
      Debug.Message("sumlimit " .. tostring(aux.sumlimit(SUMMON_TYPE_RITUAL)(nil,nil,0,SUMMON_TYPE_RITUAL)))
      local evil_effect=Effect.CreateEffect(faceup_monster)
      local dark_fusion_effect=Effect.CreateEffect(dark_fusion)
      local super_poly_effect=Effect.CreateEffect(super_poly)
      Debug.Message("evil hero direct " .. tostring(aux.EvilHeroLimit(evil_effect,dark_fusion_effect,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.EvilHeroLimit(evil_effect,value_effect,0,SUMMON_TYPE_FUSION)))
      local dark_unity=Effect.CreateEffect(faceup_monster)
      dark_unity:SetType(EFFECT_TYPE_FIELD)
      dark_unity:SetCode(300306009)
      dark_unity:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      dark_unity:SetTargetRange(1,0)
      Duel.RegisterEffect(dark_unity,0)
      Debug.Message("evil hero skill " .. tostring(aux.EvilHeroLimit(evil_effect,super_poly_effect,0,SUMMON_TYPE_FUSION)))
      local supreme_castle=Effect.CreateEffect(faceup_monster)
      supreme_castle:SetType(EFFECT_TYPE_FIELD)
      supreme_castle:SetCode(72043279)
      supreme_castle:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      supreme_castle:SetTargetRange(1,0)
      Duel.RegisterEffect(supreme_castle,0)
      Debug.Message("evil hero castle " .. tostring(aux.EvilHeroLimit(evil_effect,value_effect,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.EvilHeroLimit(evil_effect,value_effect,0,SUMMON_TYPE_SYNCHRO)))
      local fossil_effect=Effect.CreateEffect(fossil_target)
      local fossil_fusion_effect=Effect.CreateEffect(fossil_fusion)
      Debug.Message("fossil limit " .. tostring(aux.FossilLimit(evil_effect,value_effect,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.FossilLimit(fossil_effect,fossil_fusion_effect,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.FossilLimit(fossil_effect,super_poly_effect,0,SUMMON_TYPE_FUSION)))
      local hint=aux.RegisterClientHint(faceup_monster,EFFECT_FLAG_OATH,0,1,0,777,RESET_SELF_TURN,2)
      local hint_range_self,hint_range_opp=hint:GetTargetRange()
      local hint_reset,hint_reset_count=hint:GetReset()
      Debug.Message("client hint " .. hint:GetDescription() .. "/" .. hint_range_self .. "/" .. hint_range_opp .. "/" .. hint_reset_count .. "/" .. tostring(hint:IsHasProperty(EFFECT_FLAG_CLIENT_HINT)) .. "/" .. tostring(hint:IsHasProperty(EFFECT_FLAG_OATH)))
      Debug.Message("client hint default nil " .. tostring(aux.RegisterClientHint(nil,0,0,1,0)==nil))
      local global_state={}
      local global_count=0
      aux.GlobalCheck(global_state,function()
        global_count=global_count+1
      end)
      aux.GlobalCheck(global_state,function()
        global_count=global_count+1
      end)
      Debug.Message("global check " .. tostring(global_state.global_check) .. "/" .. global_count)
      local extra_rules_state={}
      local extra_rules_effect=aux.EnableExtraRules(faceup_monster,extra_rules_state,function(c,minatk)
        Debug.Message("extra rules init " .. c:GetCode() .. "/" .. minatk)
        return c:GetAttack()>=minatk
      end,900)
      Debug.Message("extra rules effect " .. extra_rules_effect:GetType() .. "/" .. extra_rules_effect:GetCode() .. "/" .. extra_rules_effect:GetProperty() .. "/" .. tostring(extra_rules_state.global_active_check))
      Debug.Message("extra rules op " .. tostring(extra_rules_effect:GetOperation()(extra_rules_effect,0,Group.CreateGroup(),0,0,nil,0,0)) .. "/" .. tostring(extra_rules_state.global_active_check))
      local all_cards = Duel.GetFieldGroup(0, LOCATION_HAND + LOCATION_MZONE, 0)
      local iter_count=0
      local iter_sum=0
      for tc in aux.Next(all_cards) do
        iter_count=iter_count+1
        iter_sum=iter_sum+tc:GetCode()
      end
      Debug.Message("aux next " .. iter_count .. "/" .. iter_sum)
      local empty_iter_count=0
      for tc in aux.Next(Group.CreateGroup()) do
        empty_iter_count=empty_iter_count+1
      end
      Debug.Message("aux next empty " .. empty_iter_count)
      local plain_selected = aux.SelectUnselectGroup(all_cards, 0, 1, 2, false, false)
      Debug.Message("aux select plain " .. plain_selected:GetCount())
      local unique_names = Duel.GetMatchingGroup(aux.TRUE, 0, LOCATION_HAND + LOCATION_MZONE, 0, nil)
      Debug.Message("dpcheck unique " .. tostring(aux.dpcheck(Card.GetCode)(unique_names)))
      Debug.Message("dncheck unique " .. tostring(aux.dncheck(unique_names)))
      local duplicate_names = Group.FromCards(faceup_monster,Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst())
      local duplicate_ok,duplicate_has_repeat = aux.dncheck(duplicate_names)
      Debug.Message("dncheck duplicate " .. tostring(duplicate_ok) .. "/" .. tostring(duplicate_has_repeat))
      local same_turn_effect=Effect.CreateEffect(same_turn_grave)
      local previous_turn_effect=Effect.CreateEffect(grave_monster)
      Debug.Message("exccon turns " .. same_turn_grave:GetTurnID() .. "/" .. grave_monster:GetTurnID() .. "/" .. Duel.GetTurnCount())
      Debug.Message("exccon values " .. tostring(aux.exccon(same_turn_effect)) .. "/" .. tostring(aux.exccon(previous_turn_effect)))
      Duel.SendtoHand(same_turn_grave,nil,REASON_RETURN)
      Debug.Message("exccon return " .. tostring(aux.exccon(same_turn_effect)))
      local filtered_selected = aux.SelectUnselectGroup(all_cards, 0, 2, 2, false, false, function(sg,minatk)
        local total=0
        local tc=sg:GetFirst()
        while tc do
          total=total+tc:GetAttack()
          tc=sg:GetNext()
        end
        return total>=minatk
      end, 5000)
      Debug.Message("aux select filtered " .. filtered_selected:GetCount())
      local missed_selected = aux.SelectUnselectGroup(all_cards, 0, 2, 2, false, false, function(sg,minatk)
        local total=0
        local tc=sg:GetFirst()
        while tc do
          total=total+tc:GetAttack()
          tc=sg:GetNext()
        end
        return total>=minatk
      end, 7000)
      Debug.Message("aux select missed " .. missed_selected:GetCount())
      Debug.Message("target exists " .. tostring(Duel.IsExistingTarget(aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, nil)))
      Debug.Message("target count " .. Duel.GetTargetCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      `,
      "aux-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.getGlobalNumber("observed_stringid")).toBe(1602);
    expect(host.messages).toContain("players count 1/1");
    expect(host.messages).toContain("true count 1");
    expect(host.messages).toContain("false count 0");
    expect(host.messages).toContain("wrapped count 0");
    expect(host.messages).toContain("nvfilter false/true");
    expect(host.messages).toContain("wrapped ex count 1");
    expect(host.messages).toContain("wrapped ex2 true/false");
    expect(host.messages).toContain("target bool count 1");
    expect(host.messages).toContain("faceup count 1");
    expect(host.messages).toContain("faceup runtime count 1");
    expect(host.messages).toContain("sp elim grave true");
    expect(host.messages).toContain("is zone true/false/true");
    expect(host.messages).toContain("sp elim faceup mzone false/true");
    expect(host.messages).toContain("sp elim facedown mzone false/true");
    expect(host.messages).toContain("maximum defaults false/false/false/true");
    expect(host.messages).toContain("maximum ex count 1");
    expect(host.messages).toContain("maximum side count 0");
    expect(host.messages).toContain("not count 1");
    expect(host.messages).toContain("and count 1");
    expect(host.messages).toContain("or count 2");
    expect(host.messages).toContain("coin hint 62/63/nil");
    expect(host.messages).toContain("field summon tg true/false/true/false");
    expect(host.messages).toContain("values reset setup 1210/1/true");
    expect(host.messages).toContain("values reset call false/11");
    expect(host.messages).toContain("summon gate 2/true/false/nil/true");
    expect(host.messages).toContain("named args A/B/7/X/Y/11");
    expect(host.messages).toContain("cannot mat true/false/true");
    expect(host.messages).toContain("chkf mmz true/false");
    expect(host.messages).toContain("ritlimit true/false");
    expect(host.messages).toContain("value helpers own false/true/false");
    expect(host.messages).toContain("value helpers opponent true/false/true");
    expect(host.messages).toContain("imval helpers true/false/true");
    expect(host.messages).toContain("chainreg flag 1");
    expect(host.messages).toContain("sumreg flags 1/1");
    expect(host.messages).toContain("extra limits true/true/true");
    expect(host.messages).toContain("extra misses false/false/false");
    expect(host.messages).toContain("sumlimit true");
    expect(host.messages).toContain("evil hero direct true/nil");
    expect(host.messages).toContain("evil hero skill true");
    expect(host.messages).toContain("evil hero castle true/false");
    expect(host.messages).toContain("fossil limit true/true/false");
    expect(host.messages).toContain("client hint 777/1/0/2/true/true");
    expect(host.messages).toContain("client hint default nil true");
    expect(host.messages).toContain("global check true/1");
    expect(host.messages).toContain("extra rules effect 2050/1040/263168/nil");
    expect(host.messages).toContain("extra rules init 100/900");
    expect(host.messages).toContain("extra rules op true/true");
    expect(host.messages).toContain("aux next 3/600");
    expect(host.messages).toContain("aux next empty 0");
    expect(host.messages).toContain("aux select plain 2");
    expect(host.messages).toContain("dpcheck unique true");
    expect(host.messages).toContain("dncheck unique true");
    expect(host.messages).toContain("dncheck duplicate false/true");
    expect(host.messages).toContain("exccon turns 1/0/1");
    expect(host.messages).toContain("exccon values false/true");
    expect(host.messages).toContain("exccon return true");
    expect(host.messages).toContain("aux select filtered 2");
    expect(host.messages).toContain("aux select missed 0");
    expect(host.messages).toContain("target exists true");
    expect(host.messages).toContain("target count 2");
  });

  it("provides deterministic Lua option prompt helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Prompt Source", kind: "monster", attribute: 0x1 },
      { code: "200", name: "Prompt Target", kind: "monster", attribute: 0x2 },
    ];
    const session = createDuel({ seed: 30, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local option=Duel.SelectOption(0, 101, 102, 103)
      local yes=Duel.SelectYesNo(0, 201)
      local effect_yes=Duel.SelectEffectYesNo(0, nil, 202)
      local effect_choice=Duel.SelectEffect(0, {false, 301}, {true, 302}, {true, 303})
      local effect_none=Duel.SelectEffect(0, {false, 301})
      local number=Duel.AnnounceNumber(0, 4, 7, 9)
      local card=Duel.AnnounceCard(0, 100, 200)
      local kind=Duel.AnnounceType(0, TYPE_MONSTER, TYPE_SPELL)
      local race=Duel.AnnounceRace(0, RACE_WARRIOR, RACE_SPELLCASTER)
      local attribute=Duel.AnnounceAttribute(0, ATTRIBUTE_LIGHT, ATTRIBUTE_DARK)
      local level=Duel.AnnounceLevel(0, 3, 5, 7)
      local ranged=Duel.AnnounceNumberRange(0, 2, 5, 2, 3)
      local selected_code=Duel.SelectCardsFromCodes(0, 1, 1, false, false, 700, 800)
      local selected_from_table=Duel.SelectCardsFromCodes(0, 1, 1, false, false, {900, 901})
      local selected_index=Duel.SelectCardsFromCodes(0, 1, 1, false, true, 910, 920)
      local selected_multi={Duel.SelectCardsFromCodes(0, 1, 2, false, true, 930, 940, 950)}
      local disabled=Duel.SelectDisableField(0, 1, LOCATION_MZONE, 0, 0)
      local selected=Duel.SelectField(0, 2, LOCATION_SZONE, LOCATION_MZONE, 0)
      local selected_zone=Duel.SelectFieldZone(0, 1, 0, LOCATION_MZONE, 0)
      local group=Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 2, nil)
      local earth_group=Duel.SelectMatchingCard(0, Card.IsCode, 0, LOCATION_HAND, 0, 1, 1, nil, 100)
      local another_earth=Duel.AnnounceAnotherAttribute(earth_group, 0)
      local another_mixed=Duel.AnnounceAnotherAttribute(group, 0)
      local single=group:GetFirst()
      local group_hint_result=Duel.HintSelection(group, 501)
      local card_hint_result=Duel.HintSelection(single)
      Debug.Message("prompt option " .. option .. "/" .. tostring(yes))
      Debug.Message("prompt effect " .. tostring(effect_yes) .. "/" .. tostring(effect_choice) .. "/" .. tostring(effect_none))
      Debug.Message("prompt announce " .. number .. "/" .. card .. "/" .. kind .. "/" .. race .. "/" .. attribute .. "/" .. level .. "/" .. ranged)
      Debug.Message("prompt card codes " .. selected_code .. "/" .. selected_from_table .. "/" .. selected_index[1] .. ":" .. selected_index[2] .. "/" .. selected_multi[1][1] .. ":" .. selected_multi[1][2] .. "," .. selected_multi[2][1] .. ":" .. selected_multi[2][2])
      Debug.Message("prompt another attribute " .. another_earth .. "/" .. another_mixed)
      Debug.Message("prompt zones " .. disabled .. "/" .. selected .. "/" .. selected_zone .. "/" .. ZONES_MMZ .. "/" .. ZONES_EMZ)
      Debug.Message("hint return " .. tostring(group_hint_result == nil) .. "/" .. tostring(card_hint_result == nil))
      `,
      "prompt-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("prompt option 0/true");
    expect(host.messages).toContain("prompt effect true/2/nil");
    expect(host.messages).toContain("prompt announce 4/100/1/1/16/3/4");
    expect(host.messages).toContain("prompt card codes 700/900/910:1/930:1,940:2");
    expect(host.messages).toContain("prompt another attribute 2/1");
    expect(host.messages).toContain("prompt zones 1/768/65536/31/96");
    expect(host.messages).toContain("hint return true/true");
    const hintLogs = session.state.log.filter((entry) => entry.action === "hintSelection");
    expect(hintLogs).toHaveLength(2);
    expect(hintLogs[0]).toMatchObject({ player: 0 });
    expect(hintLogs[0]?.detail).toMatch(/^2 selected: (100,200|200,100) \(501\)$/);
    expect(hintLogs[1]?.detail).toMatch(/^1 selected: (100|200)$/);
  });

  it("checks Lua sequence movement adjacency conditions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Blocked", kind: "monster" },
      { code: "200", name: "Middle", kind: "monster" },
    ];
    const session = createDuel({ seed: 91, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const blocked = session.state.cards.find((card) => card.code === "100");
    const middle = session.state.cards.find((card) => card.code === "200");
    expect(blocked).toBeTruthy();
    expect(middle).toBeTruthy();
    moveDuelCard(session.state, blocked!.uid, "monsterZone", 0).sequence = 0;
    moveDuelCard(session.state, middle!.uid, "monsterZone", 0).sequence = 1;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local blocked=Duel.GetFieldCard(0,LOCATION_MZONE,0)
      local middle=Duel.GetFieldCard(0,LOCATION_MZONE,1)
      Debug.Message("seqmovcon " .. tostring(aux.seqmovcon(Effect.CreateEffect(middle))) .. "/" .. tostring(aux.seqmovcon(Effect.CreateEffect(blocked))))
      `,
      "seqmovcon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("seqmovcon true/false");
  });

  it("lets Lua scripts check additional summon availability", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Extra Summon Source", kind: "monster" },
      { code: "200", name: "Zone Filler A", kind: "monster" },
      { code: "300", name: "Zone Filler B", kind: "monster" },
      { code: "400", name: "Zone Filler C", kind: "monster" },
      { code: "500", name: "Zone Filler D", kind: "monster" },
    ];
    const session = createDuel({ seed: 31, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const before = host.loadScript(
      `
      Debug.Message("additional before " .. tostring(Duel.IsPlayerCanAdditionalSummon(0)) .. "/" .. tostring(Duel.IsPlayerCanAdditionalSummon(1)))
      `,
      "additional-summon-before.lua",
    );
    expect(before.ok, before.error).toBe(true);

    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_EXTRA_SUMMON_COUNT)
        e:SetRange(LOCATION_MZONE)
        c:RegisterEffect(e)
      end
      `,
      "additional-summon-effect.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const withEffect = host.loadScript(
      `
      Debug.Message("additional with effect " .. tostring(Duel.IsPlayerCanAdditionalSummon(0)))
      `,
      "additional-summon-with-effect.lua",
    );
    expect(withEffect.ok, withEffect.error).toBe(true);

    for (const code of ["200", "300", "400", "500"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const fullZone = host.loadScript(
      `
      Debug.Message("additional full zone " .. tostring(Duel.IsPlayerCanAdditionalSummon(0)))
      `,
      "additional-summon-full-zone.lua",
    );

    expect(fullZone.ok, fullZone.error).toBe(true);
    expect(host.messages).toContain("additional before true/false");
    expect(host.messages).toContain("additional with effect false");
    expect(host.messages).toContain("additional full zone false");
  });

  it("exposes summon type metadata to Lua card helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon A", kind: "monster" },
      { code: "300", name: "Summon B", kind: "monster" },
      { code: "900", name: "Summon Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 19, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const normalUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === normalUid);
    expect(normal).toBeDefined();
    expect(applyResponse(session, normal!).ok).toBe(true);

    const host = createLuaScriptHost(session);
    const normalResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("phase activity after summon " .. tostring(Duel.CheckPhaseActivity()))
      Debug.Message("normal type " .. tostring(c:IsSummonType(SUMMON_TYPE_NORMAL)) .. "/" .. c:GetSummonType())
      Debug.Message("normal location " .. tostring(c:IsSummonLocation(LOCATION_HAND)) .. "/" .. tostring(c:IsSummonLocation(LOCATION_EXTRA)))
      Debug.Message("normal status " .. tostring(c:IsStatus(STATUS_SUMMON_TURN)) .. "/" .. tostring(c:IsStatus(STATUS_SPSUMMON_TURN)) .. "/" .. tostring(c:IsStatus(STATUS_PROC_COMPLETE)) .. "/" .. tostring(c:IsStatus(STATUS_EFFECT_ENABLED)) .. "/" .. tostring(c:IsStatus(STATUS_NO_LEVEL)))
      Debug.Message("normal activity " .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON))
      `,
      "summon-type-normal.lua",
    );

    expect(normalResult.ok).toBe(true);
    expect(host.messages).toContain("phase activity after summon true");
    expect(host.messages).toContain("normal type true/268435456");
    expect(host.messages).toContain("normal location true/false");
    expect(host.messages).toContain("normal status true/false/true/true/true");
    expect(host.messages).toContain("normal activity 1/1/0");

    const fusion = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon");
    expect(fusion).toBeDefined();
    expect(applyResponse(session, fusion!).ok).toBe(true);
    const fusionCard = session.state.cards.find((card) => card.code === "900");
    expect(fusionCard?.summonType).toBe("fusion");
    fusionCard!.summonTypeCode = 0x40000000 + 151;

    const fusionResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion type " .. tostring(c:IsSummonType(SUMMON_TYPE_FUSION)) .. "/" .. tostring(c:IsSummonType(SUMMON_TYPE_SPECIAL)))
      Debug.Message("fusion location " .. tostring(c:IsSummonLocation(LOCATION_EXTRA)) .. "/" .. tostring(c:IsSummonLocation(LOCATION_HAND)))
      local e=Effect.CreateEffect(c)
      Debug.Message("custom summon type " .. c:GetSummonType() .. "/" .. tostring(aux.evospcon(e)) .. "/" .. tostring(aux.gbspcon(e)))
      Debug.Message("fusion status " .. tostring(c:IsStatus(STATUS_SUMMON_TURN)) .. "/" .. tostring(c:IsStatus(STATUS_SPSUMMON_TURN)) .. "/" .. tostring(c:IsStatus(STATUS_PROC_COMPLETE)))
      Debug.Message("fusion activity " .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON))
      cost_reason = REASON_COST
      `,
      "summon-type-fusion.lua",
    );

    expect(fusionResult.ok).toBe(true);
    expect(host.messages).toContain("fusion type false/true");
    expect(host.messages).toContain("fusion location true/false");
    expect(host.messages).toContain("custom summon type 1073741975/true/false");
    expect(host.messages).toContain("fusion status false/true/true");
    expect(host.messages).toContain("fusion activity 2/1/1");
    expect(host.getGlobalNumber("cost_reason")).toBe(0x80);

    fusionCard!.summonTypeCode = 0x40000000 + 120;
    const gladiatorResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      Debug.Message("gladiator summon type " .. c:GetSummonType() .. "/" .. tostring(aux.evospcon(e)) .. "/" .. tostring(aux.gbspcon(e)))
      `,
      "summon-type-gladiator.lua",
    );
    expect(gladiatorResult.ok, gladiatorResult.error).toBe(true);
    expect(host.messages).toContain("gladiator summon type 1073741944/false/true");

    const phase = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase");
    expect(phase).toBeDefined();
    expect(applyResponse(session, phase!).ok).toBe(true);
    const phaseResult = host.loadScript(
      `
      Debug.Message("phase activity after change " .. tostring(Duel.CheckPhaseActivity()))
      `,
      "phase-activity-reset.lua",
    );
    expect(phaseResult.ok, phaseResult.error).toBe(true);
    expect(host.messages).toContain("phase activity after change false");
  });

  it("lets Lua scripts count custom filtered activities", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Allowed Special", kind: "monster" },
      { code: "200", name: "Blocked Special", kind: "monster" },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      Duel.AddCustomActivityCounter(9700, ACTIVITY_SPSUMMON, aux.FilterBoolFunction(Card.IsCode, 100))
      Debug.Message("custom initial " .. Duel.GetCustomActivityCount(9700, 0, ACTIVITY_SPSUMMON))
      `,
      "custom-activity-setup.lua",
    );

    expect(setup.ok, setup.error).toBe(true);
    expect(host.messages).toContain("custom initial 0");
    specialSummonDuelCard(session.state, session.state.cards.find((card) => card.code === "100")!.uid, 0);

    const afterAllowed = host.loadScript(
      `
      Debug.Message("custom allowed " .. Duel.GetCustomActivityCount(9700, 0, ACTIVITY_SPSUMMON))
      `,
      "custom-activity-allowed.lua",
    );

    expect(afterAllowed.ok, afterAllowed.error).toBe(true);
    expect(host.messages).toContain("custom allowed 0");
    specialSummonDuelCard(session.state, session.state.cards.find((card) => card.code === "200")!.uid, 0);

    const afterBlocked = host.loadScript(
      `
      Debug.Message("custom blocked " .. Duel.GetCustomActivityCount(9700, 0, ACTIVITY_SPSUMMON))
      `,
      "custom-activity-blocked.lua",
    );

    expect(afterBlocked.ok, afterBlocked.error).toBe(true);
    expect(host.messages).toContain("custom blocked 1");
    expect(session.state.activityHistory.filter((record) => record.activity === 0x4)).toHaveLength(2);
  });

  it("exposes card owner, controller, location, sequence, and position metadata", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "State Probe", kind: "monster", typeFlags: 0x21, attack: 1700, defense: 1300, level: 4, race: 0x2, attribute: 0x20, setcodes: [0x123] },
      { code: "900", name: "Hidden Extra", kind: "extra" },
    ];
    const session = createDuel({ seed: 20, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"], extra: ["900"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon");
    expect(normal).toBeDefined();
    expect(applyResponse(session, normal!).ok).toBe(true);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("card state " .. c:GetOwner() .. "/" .. tostring(c:IsOwner(0)) .. "/" .. c:GetControler() .. "/" .. c:GetLocation() .. "/" .. c:GetSequence() .. "/" .. c:GetPosition())
      Debug.Message("original meta " .. c:GetOriginalCode() .. "/" .. c:GetOriginalType() .. "/" .. c:GetOriginalLevel() .. "/" .. c:GetOriginalRace() .. "/" .. c:GetOriginalAttribute())
      Debug.Message("base stats " .. c:GetBaseAttack() .. "/" .. c:GetBaseDefense())
      Debug.Message("position checks " .. tostring(c:IsPosition(POS_FACEUP_ATTACK)) .. "/" .. tostring(c:IsControler(0)))
      local hidden = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      Debug.Message("public checks " .. tostring(c:IsPublic()) .. "/" .. tostring(hidden:IsPublic()))
      Debug.Message("relation checks " .. tostring(c:IsOnField()) .. "/" .. tostring(c:IsMonster()) .. "/" .. tostring(c:IsSpell()) .. "/" .. tostring(c:IsTrap()) .. "/" .. tostring(c:IsCanBeEffectTarget(nil)))
      Debug.Message("material checks " .. tostring(c:IsCanBeFusionMaterial(nil)) .. "/" .. tostring(c:IsCanBeSynchroMaterial(nil)) .. "/" .. tostring(c:IsCanBeXyzMaterial(nil)) .. "/" .. tostring(c:IsCanBeLinkMaterial(nil)) .. "/" .. tostring(c:IsCanBeRitualMaterial(nil)))
      Debug.Message("activity counts " .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_FLIPSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_ATTACK))
      Debug.Message("used summon legality " .. tostring(Duel.IsPlayerCanSummon(0, c)) .. "/" .. tostring(Duel.IsPlayerCanMSet(0, c)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, c)))
      Duel.SendtoGrave(c, REASON_EFFECT)
      local g = Duel.GetFieldCard(0, LOCATION_GRAVE, 0)
      Debug.Message("previous state " .. g:GetPreviousLocation() .. "/" .. g:GetPreviousControler() .. "/" .. g:GetPreviousSequence() .. "/" .. g:GetPreviousPosition())
      Debug.Message("previous checks " .. tostring(g:IsPreviousLocation(LOCATION_MZONE)) .. "/" .. tostring(g:IsPreviousControler(0)) .. "/" .. tostring(g:IsPreviousPosition(POS_FACEUP_ATTACK)) .. "/" .. tostring(g:IsPreviousSetCard(0x123)))
      Debug.Message("previous identity " .. g:GetPreviousCode() .. "/" .. tostring(g:IsPreviousCode(100)) .. "/" .. tostring(g:IsPreviousCode(900)))
      Debug.Message("previous type " .. g:GetPreviousTypeOnField() .. "/" .. tostring(g:IsPreviousTypeOnField(TYPE_EFFECT)) .. "/" .. tostring(g:IsPreviousTypeOnField(TYPE_SPELL)))
      Debug.Message("previous stats " .. g:GetPreviousAttackOnField() .. "/" .. tostring(g:IsPreviousAttackOnField(1700)) .. "/" .. g:GetPreviousDefenseOnField() .. "/" .. tostring(g:IsPreviousDefenseOnField(1300)))
      Debug.Message("previous level " .. g:GetPreviousLevelOnField() .. "/" .. tostring(g:IsPreviousLevelOnField(4)) .. "/" .. tostring(g:IsPreviousLevelOnField(7)))
      Debug.Message("previous extra stats " .. g:GetPreviousRankOnField() .. "/" .. tostring(g:IsPreviousRankOnField(4)) .. "/" .. g:GetPreviousLinkOnField() .. "/" .. tostring(g:IsPreviousLinkOnField(2)))
      Debug.Message("previous traits " .. g:GetPreviousRaceOnField() .. "/" .. tostring(g:IsPreviousRaceOnField(RACE_SPELLCASTER)) .. "/" .. g:GetPreviousAttributeOnField() .. "/" .. tostring(g:IsPreviousAttributeOnField(ATTRIBUTE_DARK)))
      Debug.Message("previous visibility " .. tostring(g:WasFaceup()) .. "/" .. tostring(g:WasFacedown()))
      Debug.Message("reason player " .. g:GetReasonPlayer() .. "/" .. tostring(g:IsReasonPlayer(0)) .. "/" .. tostring(g:IsReasonPlayer(1)))
      Debug.Message("grave relation " .. tostring(g:IsOnField()) .. "/" .. tostring(g:IsMonster()))
      `,
      "card-state.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("card state 0/true/0/4/0/1");
    expect(host.messages).toContain("original meta 100/33/4/2/32");
    expect(host.messages).toContain("base stats 1700/1300");
    expect(host.messages).toContain("position checks true/true");
    expect(host.messages).toContain("public checks true/false");
    expect(host.messages).toContain("relation checks true/true/false/false/true");
    expect(host.messages).toContain("material checks true/true/true/true/true");
    expect(host.messages).toContain("activity counts 1/1/0/0/0");
    expect(host.messages).toContain("used summon legality false/false/false");
    expect(host.messages).toContain("previous state 4/0/0/1");
    expect(host.messages).toContain("previous checks true/true/true/true");
    expect(host.messages).toContain("previous identity 100/true/false");
    expect(host.messages).toContain("previous type 33/true/false");
    expect(host.messages).toContain("previous stats 1700/true/1300/true");
    expect(host.messages).toContain("previous level 4/true/false");
    expect(host.messages).toContain("previous extra stats 0/false/0/false");
    expect(host.messages).toContain("previous traits 2/true/32/true");
    expect(host.messages).toContain("previous visibility true/false");
    expect(host.messages).toContain("reason player 0/true/false");
    expect(host.messages).toContain("grave relation false/true");
  });

  it("lets Lua scripts check whether cards have non-zero attack", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Nonzero Attack", kind: "monster", attack: 1500, defense: 1200 },
      { code: "200", name: "Zero Attack", kind: "monster", attack: 0, defense: 0 },
      { code: "300", name: "Missing Attack", kind: "monster" },
    ];
    const session = createDuel({ seed: 70, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local positive = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local zero = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local missing = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("nonzero attack " .. tostring(positive:HasNonZeroAttack()))
      Debug.Message("zero attack " .. tostring(zero:HasNonZeroAttack()))
      Debug.Message("missing attack " .. tostring(missing:HasNonZeroAttack()))
      Debug.Message("nonzero defense " .. tostring(positive:HasNonZeroDefense()))
      Debug.Message("zero defense " .. tostring(zero:HasNonZeroDefense()))
      Debug.Message("missing defense " .. tostring(missing:HasNonZeroDefense()))
      `,
      "has-nonzero-attack.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("nonzero attack true");
    expect(host.messages).toContain("zero attack false");
    expect(host.messages).toContain("missing attack false");
    expect(host.messages).toContain("nonzero defense true");
    expect(host.messages).toContain("zero defense false");
    expect(host.messages).toContain("missing defense false");
  });

  it("lets Lua scripts add and remove card counters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Self Counter", kind: "monster" },
      { code: "200", name: "Opponent Counter", kind: "monster" },
      { code: "300", name: "Deck Counter", kind: "monster" },
    ];
    const session = createDuel({ seed: 77, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const self = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const opponent = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const deck = session.state.cards.find((card) => card.controller === 0 && card.code === "300");
    expect(self).toBeDefined();
    expect(opponent).toBeDefined();
    expect(deck).toBeDefined();
    moveDuelCard(session.state, self!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);
    moveDuelCard(session.state, deck!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local self = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opp = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local deck = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_DECK, 0, 1, 1, nil):GetFirst()
      Debug.Message("add self " .. tostring(self:AddCounter(99, 2)) .. "/" .. self:GetCounter(99) .. "/" .. tostring(self:HasCounter()))
      Debug.Message("add opp " .. tostring(opp:AddCounter(99, 1)) .. "/" .. opp:GetCounter(99))
      Debug.Message("can add deck " .. tostring(deck:IsCanAddCounter(99, 1)) .. "/" .. tostring(deck:AddCounter(99, 1)))
      Debug.Message("duel can add " .. tostring(Duel.IsCanAddCounter(0, 99, 1, self)) .. "/" .. tostring(Duel.IsCanAddCounter(0, 99, 1, deck)) .. "/" .. tostring(Duel.IsCanAddCounter(0, 99, 1)))
      Debug.Message("can remove self " .. tostring(Duel.IsCanRemoveCounter(0, 1, 0, 99, 2, REASON_COST)))
      Debug.Message("can remove both " .. tostring(Duel.IsCanRemoveCounter(0, 1, 1, 99, 3, REASON_COST)))
      Debug.Message("duel counter totals " .. Duel.GetCounter(0, 1, 0, 99) .. "/" .. Duel.GetCounter(0, 1, 1, 99))
      Debug.Message("remove one " .. tostring(self:RemoveCounter(0, 99, 1, REASON_COST)) .. "/" .. self:GetCounter(99))
      Debug.Message("duel remove " .. Duel.RemoveCounter(0, 1, 1, 99, 2, REASON_COST))
      Debug.Message("duel operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("after counters " .. self:GetCounter(99) .. "/" .. opp:GetCounter(99))
      `,
      "card-counters.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("add self true/2/true");
    expect(host.messages).toContain("add opp true/1");
    expect(host.messages).toContain("can add deck false/false");
    expect(host.messages).toContain("duel can add true/false/true");
    expect(host.messages).toContain("can remove self true");
    expect(host.messages).toContain("can remove both true");
    expect(host.messages).toContain("duel counter totals 2/3");
    expect(host.messages).toContain("remove one true/1");
    expect(host.messages).toContain("duel remove 2");
    expect(host.messages).toContain("duel operated 2");
    expect(host.messages).toContain("after counters 0/0");
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.cards.find((card) => card.uid === self!.uid)?.counters).toBeUndefined();
  });

  it("lets Lua scripts check whether cards can change battle position", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Face-up Monster", kind: "monster" },
      { code: "200", name: "Face-down Monster", kind: "monster" },
      { code: "300", name: "Link Monster", kind: "extra", typeFlags: 0x4000001, level: 2 },
      { code: "400", name: "Hand Monster", kind: "monster" },
      { code: "500", name: "Already Attacked", kind: "monster" },
    ];
    const session = createDuel({ seed: 21, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "400", "500"], extra: ["300"] },
      1: { main: ["400", "400", "400", "400"] },
    });
    startDuel(session);

    const faceUp = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const faceDown = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const attacked = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const link = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "300");
    expect(faceUp).toBeDefined();
    expect(faceDown).toBeDefined();
    expect(attacked).toBeDefined();
    expect(link).toBeDefined();
    moveDuelCard(session.state, faceUp!.uid, "monsterZone", 0).position = "faceUpAttack";
    const setMonster = moveDuelCard(session.state, faceDown!.uid, "monsterZone", 0);
    setMonster.position = "faceDownDefense";
    setMonster.faceUp = false;
    moveDuelCard(session.state, link!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attacked!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.attacksDeclared.push(attacked!.uid);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local faceup = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local facedown = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local link = Duel.GetFieldCard(0, LOCATION_MZONE, 2)
      local attacked = Duel.GetFieldCard(0, LOCATION_MZONE, 3)
      local hand = Duel.GetFieldCard(0, LOCATION_HAND, 0)
      Debug.Message("turn set faceup " .. tostring(faceup:IsCanTurnSet()))
      Debug.Message("turn set facedown " .. tostring(facedown:IsCanTurnSet()))
      Debug.Message("turn set link " .. tostring(link:IsCanTurnSet()))
      Debug.Message("turn set hand " .. tostring(hand:IsCanTurnSet()))
      Debug.Message("change faceup any " .. tostring(faceup:IsCanChangePosition()))
      Debug.Message("change rush faceup any " .. tostring(faceup:IsCanChangePositionRush()))
      Debug.Message("change faceup defense " .. tostring(faceup:IsCanChangePosition(POS_FACEUP_DEFENSE)))
      Debug.Message("change rush faceup defense " .. tostring(faceup:IsCanChangePositionRush(POS_FACEUP_DEFENSE)))
      Debug.Message("change faceup attack " .. tostring(faceup:IsCanChangePosition(POS_FACEUP_ATTACK)))
      Debug.Message("change facedown any " .. tostring(facedown:IsCanChangePosition()))
      Debug.Message("change link any " .. tostring(link:IsCanChangePosition()))
      Debug.Message("change hand any " .. tostring(hand:IsCanChangePosition()))
      Debug.Message("change attacked any " .. tostring(attacked:IsCanChangePosition()))
      `,
      "card-position-predicates.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "turn set faceup true",
      "turn set facedown false",
      "turn set link false",
      "turn set hand false",
      "change faceup any true",
      "change rush faceup any true",
      "change faceup defense true",
      "change rush faceup defense true",
      "change faceup attack false",
      "change facedown any true",
      "change link any true",
      "change hand any false",
      "change attacked any false",
    ]);
  });

  it("lets Lua scripts build summon-code filters", () => {
    const cards: DuelCardData[] = [
      { code: "100", alias: "101", name: "Aliased Summon Material", kind: "monster" },
      { code: "300", name: "Other Summon Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 164, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local aliased = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local other = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local filter = aux.FilterSummonCode(101, 500)
      Debug.Message("summon code direct " .. tostring(aliased:IsSummonCode(nil, 0, 0, 101)))
      Debug.Message("summon code filter alias " .. tostring(filter(aliased, nil, 0, 0)))
      Debug.Message("summon code filter miss " .. tostring(filter(other, nil, 0, 0)))
      `,
      "summon-code-filter.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("summon code direct true");
    expect(host.messages).toContain("summon code filter alias true");
    expect(host.messages).toContain("summon code filter miss false");
  });
});
