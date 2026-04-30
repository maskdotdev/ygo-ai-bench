import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
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

    expect(result.ok).toBe(true);
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

    expect(result.ok).toBe(true);
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

    expect(result.ok).toBe(true);
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

    expect(result.ok).toBe(true);
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
    ];
    const session = createDuel({ seed: 18, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const faceup = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const facedown = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const graveyard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "400");
    moveDuelCard(session.state, faceup!.uid, "monsterZone", 0).position = "faceUpAttack";
    const setCard = moveDuelCard(session.state, facedown!.uid, "monsterZone", 0);
    setCard.position = "faceDownDefense";
    setCard.faceUp = false;
    moveDuelCard(session.state, graveyard!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_stringid = aux.Stringid(100, 2)
      Debug.Message("true count " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      Debug.Message("false count " .. Duel.GetMatchingGroupCount(aux.FALSE, 0, LOCATION_HAND, 0, nil))
      local wrapped = aux.NecroValleyFilter(aux.FilterBoolFunction(Card.IsCode, 100))
      Debug.Message("wrapped count " .. Duel.GetMatchingGroupCount(wrapped, 0, LOCATION_HAND, 0, nil))
      local wrapped_ex = aux.FilterBoolFunctionEx(function(c, minatk, code) return c:GetAttack() >= minatk and c:IsCode(code) end, 1500)
      Debug.Message("wrapped ex count " .. Duel.GetMatchingGroupCount(wrapped_ex, 0, LOCATION_HAND, 0, nil, 300))
      local target_bool = aux.TargetBoolFunction(function(c, minatk, code) return c:GetAttack() >= minatk and c:IsCode(code) end, 2500)
      Debug.Message("target bool count " .. Duel.GetMatchingGroupCount(target_bool, 0, LOCATION_HAND, 0, nil, 300))
      local faceup_filter = aux.FaceupFilter(function(c, minatk) return c:GetAttack() >= minatk end, 900)
      Debug.Message("faceup count " .. Duel.GetMatchingGroupCount(faceup_filter, 0, LOCATION_MZONE, 0, nil))
      Debug.Message("faceup runtime count " .. Duel.GetMatchingGroupCount(aux.FaceupFilter(function(c, minatk) return c:GetAttack() >= minatk end), 0, LOCATION_MZONE, 0, nil, 900))
      local faceup_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local facedown_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local grave_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("sp elim grave " .. tostring(aux.SpElimFilter(grave_monster)))
      Debug.Message("sp elim faceup mzone " .. tostring(aux.SpElimFilter(faceup_monster, true)) .. "/" .. tostring(aux.SpElimFilter(faceup_monster, true, true)))
      Debug.Message("sp elim facedown mzone " .. tostring(aux.SpElimFilter(facedown_monster, true, true)) .. "/" .. tostring(aux.SpElimFilter(facedown_monster, false, true)))
      Debug.Message("maximum defaults " .. tostring(faceup_monster:IsMaximumMode()) .. "/" .. tostring(faceup_monster:IsMaximumModeCenter()) .. "/" .. tostring(faceup_monster:IsMaximumModeSide()) .. "/" .. tostring(faceup_monster:IsNotMaximumModeSide()))
      local maximum_wrapped = aux.FilterMaximumSideFunctionEx(function(c,minatk) return c:IsFaceup() and c:GetAttack() >= minatk end, 900)
      Debug.Message("maximum ex count " .. Duel.GetMatchingGroupCount(maximum_wrapped, 0, LOCATION_MZONE, 0, nil))
      Debug.Message("maximum side count " .. Duel.GetMatchingGroupCount(aux.FilterMaximumSideFunction(function(c) return c:IsFaceup() end), 0, LOCATION_MZONE, 0, nil))
      Debug.Message("not count " .. Duel.GetMatchingGroupCount(aux.NOT(Card.IsCode), 0, LOCATION_HAND, 0, nil, 100))
      Debug.Message("and count " .. Duel.GetMatchingGroupCount(aux.AND(Card.IsFaceup, Card.IsAttackAbove), 0, LOCATION_MZONE, 0, nil, 900))
      Debug.Message("chkf mmz " .. tostring(aux.ChkfMMZ(1)(Group.CreateGroup(), nil, 0)) .. "/" .. tostring(aux.ChkfMMZ(6)(Group.CreateGroup(), nil, 0)))
      local global_state={}
      local global_count=0
      aux.GlobalCheck(global_state,function()
        global_count=global_count+1
      end)
      aux.GlobalCheck(global_state,function()
        global_count=global_count+1
      end)
      Debug.Message("global check " .. tostring(global_state.global_check) .. "/" .. global_count)
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

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_stringid")).toBe(1602);
    expect(host.messages).toContain("true count 1");
    expect(host.messages).toContain("false count 0");
    expect(host.messages).toContain("wrapped count 0");
    expect(host.messages).toContain("wrapped ex count 1");
    expect(host.messages).toContain("target bool count 1");
    expect(host.messages).toContain("faceup count 1");
    expect(host.messages).toContain("faceup runtime count 1");
    expect(host.messages).toContain("sp elim grave true");
    expect(host.messages).toContain("sp elim faceup mzone false/true");
    expect(host.messages).toContain("sp elim facedown mzone false/true");
    expect(host.messages).toContain("maximum defaults false/false/false/true");
    expect(host.messages).toContain("maximum ex count 1");
    expect(host.messages).toContain("maximum side count 0");
    expect(host.messages).toContain("not count 1");
    expect(host.messages).toContain("and count 1");
    expect(host.messages).toContain("chkf mmz true/false");
    expect(host.messages).toContain("global check true/1");
    expect(host.messages).toContain("aux next 3/600");
    expect(host.messages).toContain("aux next empty 0");
    expect(host.messages).toContain("aux select plain 2");
    expect(host.messages).toContain("aux select filtered 2");
    expect(host.messages).toContain("aux select missed 0");
    expect(host.messages).toContain("target exists true");
    expect(host.messages).toContain("target count 1");
  });

  it("provides deterministic Lua option prompt helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Prompt Source", kind: "monster" },
      { code: "200", name: "Prompt Target", kind: "monster" },
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
      local disabled=Duel.SelectDisableField(0, 1, LOCATION_MZONE, 0, 0)
      local selected=Duel.SelectField(0, 2, LOCATION_SZONE, LOCATION_MZONE, 0)
      local group=Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 2, nil)
      local single=group:GetFirst()
      local group_hint_result=Duel.HintSelection(group, 501)
      local card_hint_result=Duel.HintSelection(single)
      Debug.Message("prompt option " .. option .. "/" .. tostring(yes))
      Debug.Message("prompt effect " .. tostring(effect_yes) .. "/" .. tostring(effect_choice) .. "/" .. tostring(effect_none))
      Debug.Message("prompt announce " .. number .. "/" .. card .. "/" .. kind .. "/" .. race .. "/" .. attribute)
      Debug.Message("prompt zones " .. disabled .. "/" .. selected .. "/" .. ZONES_MMZ .. "/" .. ZONES_EMZ)
      Debug.Message("hint return " .. tostring(group_hint_result == nil) .. "/" .. tostring(card_hint_result == nil))
      `,
      "prompt-helpers.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("prompt option 0/true");
    expect(host.messages).toContain("prompt effect true/2/nil");
    expect(host.messages).toContain("prompt announce 4/100/1/1/16");
    expect(host.messages).toContain("prompt zones 1/768/31/96");
    expect(host.messages).toContain("hint return true/true");
    const hintLogs = session.state.log.filter((entry) => entry.action === "hintSelection");
    expect(hintLogs).toHaveLength(2);
    expect(hintLogs[0]).toMatchObject({ player: 0 });
    expect(hintLogs[0]?.detail).toMatch(/^2 selected: (100,200|200,100) \(501\)$/);
    expect(hintLogs[1]?.detail).toMatch(/^1 selected: (100|200)$/);
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
      Debug.Message("normal type " .. tostring(c:IsSummonType(SUMMON_TYPE_NORMAL)) .. "/" .. c:GetSummonType())
      Debug.Message("normal activity " .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON))
      `,
      "summon-type-normal.lua",
    );

    expect(normalResult.ok).toBe(true);
    expect(host.messages).toContain("normal type true/268435456");
    expect(host.messages).toContain("normal activity 1/1/0");

    const fusion = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon");
    expect(fusion).toBeDefined();
    expect(applyResponse(session, fusion!).ok).toBe(true);
    expect(session.state.cards.find((card) => card.code === "900")?.summonType).toBe("fusion");

    const fusionResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion type " .. tostring(c:IsSummonType(SUMMON_TYPE_FUSION)) .. "/" .. tostring(c:IsSummonType(SUMMON_TYPE_SPECIAL)))
      Debug.Message("fusion activity " .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON))
      cost_reason = REASON_COST
      `,
      "summon-type-fusion.lua",
    );

    expect(fusionResult.ok).toBe(true);
    expect(host.messages).toContain("fusion type true/true");
    expect(host.messages).toContain("fusion activity 2/1/1");
    expect(host.getGlobalNumber("cost_reason")).toBe(0x80);
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
});
