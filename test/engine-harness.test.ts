import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  detachDuelOverlayMaterials,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  startDuel,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader, normalizeCdbRows, parseBanlistConf, scriptFilenameForCard, upstreamBanlistPath, upstreamDatabasePath, upstreamScriptPath } from "#engine/data-loaders.js";
import { makeResponseSelector, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("EDOPro compatibility harness scaffolding", () => {
  it("normalizes card database rows and banlist entries", () => {
    const cards = normalizeCdbRows(
      [
        { id: 100, type: 1, atk: 2500, def: 2100, level: 4, setcode: 0, race: 0x2, attribute: 0x20 },
        { id: 200, type: 2 },
        { id: 300, type: 4 },
      ],
      [
        { id: 100, name: "Fixture Monster" },
        { id: 200, name: "Fixture Spell" },
      ],
    );

    expect(cards.map((card) => card.kind)).toEqual(["monster", "spell", "trap"]);
    expect(cards[0]?.name).toBe("Fixture Monster");
    expect(cards[0]?.race).toBe(0x2);
    expect(cards[0]?.attribute).toBe(0x20);
    expect(scriptFilenameForCard(100)).toBe("c100.lua");
    const upstream = { root: ".upstream/ignis", coreUrl: "core", scriptsUrl: "scripts", databaseUrl: "db", lflistUrl: "lists" };
    expect(upstreamScriptPath(upstream, 100)).toBe(".upstream/ignis/script/c100.lua");
    expect(upstreamDatabasePath(upstream, "cards.cdb")).toBe(".upstream/ignis/cdb/cards.cdb");
    expect(upstreamBanlistPath(upstream, "lflist.conf")).toBe(".upstream/ignis/lflist.conf");
    expect(parseBanlistConf("100 1\n# comment\n200 0\n!header\n300 4")).toEqual([
      { code: "100", limit: 1 },
      { code: "200", limit: 0 },
    ]);
  });

  it("runs a scripted duel fixture against the TypeScript engine", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "normal summon fixture",
        options: { seed: 4, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "200"] },
          1: { main: ["300", "400"] },
        },
        responses: [makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })],
        expected: {
          locations: { monsterZone: ["100"] },
          logIncludes: ["Normal Summoned"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("selects extra deck scripted fixture responses by material uids", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster" },
      { code: "300", name: "Material B", kind: "monster" },
      { code: "900", name: "Fixture Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
      { code: "910", name: "Fixture Synchro", kind: "extra", synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
      { code: "920", name: "Fixture Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
      { code: "930", name: "Fixture Link", kind: "extra", linkMaterials: ["100", "300"] },
      { code: "940", name: "Fixture Ritual", kind: "monster", ritualMaterials: ["100", "300"] },
    ];
    const fixtureBase = {
      options: { seed: 3, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["100", "300"] },
      },
    } satisfies Pick<ScriptedDuelFixture, "options" | "decks">;
    const materialUids = ["p0-deck-100-0", "p0-deck-300-1"];
    const fixtures: ScriptedDuelFixture[] = [
      {
        ...fixtureBase,
        name: "fusion fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["900"] } },
        responses: [makeResponseSelector("fusionSummon", 0, { code: "900", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["900"], graveyard: ["100", "300"] }, logIncludes: ["Fusion Summoned"] },
      },
      {
        ...fixtureBase,
        name: "synchro fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["910"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeResponseSelector("synchroSummon", 0, { code: "910", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["910"], graveyard: ["100", "300"] }, logIncludes: ["Synchro Summoned"] },
      },
      {
        ...fixtureBase,
        name: "xyz fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["920"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeResponseSelector("xyzSummon", 0, { code: "920", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["920"], overlay: ["100", "300"] }, logIncludes: ["Xyz Summoned"] },
      },
      {
        ...fixtureBase,
        name: "link fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["930"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeResponseSelector("linkSummon", 0, { code: "930", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["930"], graveyard: ["100", "300"] }, logIncludes: ["Link Summoned"] },
      },
      {
        ...fixtureBase,
        name: "ritual fixture",
        options: { seed: 3, startingHandSize: 3 },
        decks: { ...fixtureBase.decks, 0: { main: ["100", "300", "940"] } },
        responses: [makeResponseSelector("ritualSummon", 0, { code: "940", location: "hand", materialUids })],
        expected: { locations: { monsterZone: ["940"], graveyard: ["100", "300"] }, logIncludes: ["Ritual Summoned"] },
      },
    ];

    for (const fixture of fixtures) {
      expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
    }
  });

  it("lets Lua scripts invoke scaffolded summon helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster" },
      { code: "300", name: "Material B", kind: "monster" },
      { code: "900", name: "Lua Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
      { code: "910", name: "Lua Synchro", kind: "extra", synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
      { code: "920", name: "Lua Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
      { code: "930", name: "Lua Link", kind: "extra", linkMaterials: ["100", "300"] },
      { code: "940", name: "Lua Ritual", kind: "monster", ritualMaterials: ["100", "300"] },
    ];
    const cases = [
      { label: "fusion", fn: "FusionSummon", target: "900", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_HAND", extra: ["900"], main: ["100", "300"] },
      { label: "synchro", fn: "SynchroSummon", target: "910", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["910"], main: ["100", "300"], field: true },
      { label: "xyz", fn: "XyzSummon", target: "920", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["920"], main: ["100", "300"], field: true },
      { label: "link", fn: "LinkSummon", target: "930", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["930"], main: ["100", "300"], field: true },
      { label: "ritual", fn: "RitualSummon", target: "940", targetLocation: "LOCATION_HAND", materials: "LOCATION_HAND", main: ["940", "100", "300"] },
    ];

    for (const current of cases) {
      const session = createDuel({ seed: 5, startingHandSize: current.main.length, cardReader: createCardReader(cards) });
      loadDecks(session, {
        0: { main: current.main, extra: current.extra ?? [] },
        1: { main: ["100", "300", "100"] },
      });
      startDuel(session);
      if (current.field) {
        for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
          moveDuelCard(session.state, card.uid, "monsterZone", 0);
        }
      }

      const host = createLuaScriptHost(session);
      const result = host.loadScript(
        `
        local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${current.target}), 0, ${current.targetLocation}, 0, 1, 1, nil):GetFirst()
        local materials = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(100) or tc:IsCode(300) end, 0, ${current.materials}, 0, 2, 2, target)
        Debug.Message("${current.label} " .. Duel.${current.fn}(target, materials))
        `,
        `${current.label}-summon.lua`,
      );

      expect(result.ok).toBe(true);
      expect(host.messages).toContain(`${current.label} 1`);
      expect(session.state.cards.find((card) => card.code === current.target)?.location).toBe("monsterZone");
    }
  });

  it("lets Lua scripts check, select, and release monster-zone groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release A", kind: "monster" },
      { code: "300", name: "Release B", kind: "monster" },
      { code: "500", name: "Release C", kind: "monster" },
    ];
    const session = createDuel({ seed: 8, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["100", "300", "500"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local filter = function(tc) return tc:IsCode(100) or tc:IsCode(300) end
      Debug.Message("can release two " .. tostring(Duel.CheckReleaseGroup(0, filter, 2, nil)))
      Debug.Message("can release three " .. tostring(Duel.CheckReleaseGroup(0, filter, 3, nil)))
      Debug.Message("can release ex two " .. tostring(Duel.CheckReleaseGroupEx(0, filter, 2, 2, nil)))
      Debug.Message("can release ex three " .. tostring(Duel.CheckReleaseGroupEx(0, filter, 3, 3, nil)))
      local gx = Duel.SelectReleaseGroupEx(0, filter, 1, 1, nil)
      Debug.Message("selected releases ex " .. gx:GetCount())
      local g = Duel.SelectReleaseGroup(0, filter, 1, 2, nil)
      Debug.Message("selected releases " .. g:GetCount())
      local excluded = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("group excluded release check " .. tostring(Duel.CheckReleaseGroup(0, aux.TRUE, 3, excluded)))
      Debug.Message("group excluded release selected " .. Duel.SelectReleaseGroup(0, aux.TRUE, 1, 3, excluded):GetCount())
      local forced = excluded:GetFirst()
      Duel.SetSelectedCard(forced)
      Debug.Message("forced release check " .. tostring(Duel.CheckReleaseGroup(0, filter, 3, nil)))
      local forced_group = Duel.SelectReleaseGroup(0, filter, 1, 3, nil)
      Debug.Message("forced release selected " .. forced_group:GetCount() .. " " .. tostring(forced_group:IsContains(forced)))
      Duel.SetSelectedCard(Group.FromCards(forced, g:GetFirst()))
      Debug.Message("forced release ex max miss " .. tostring(Duel.CheckReleaseGroupEx(0, filter, 1, 1, nil)))
      Duel.SetSelectedCard(nil)
      Debug.Message("released " .. Duel.Release(g, REASON_COST))
      local released = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("previous location " .. tostring(released:IsPreviousLocation(LOCATION_MZONE)))
      Debug.Message("previous controller " .. tostring(released:IsPreviousControler(0)))
      Debug.Message("release reason " .. tostring(released:IsReason(REASON_RELEASE)) .. "/" .. tostring(released:IsReason(REASON_COST)))
      `,
      "release-group.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("can release two true");
    expect(host.messages).toContain("can release three false");
    expect(host.messages).toContain("can release ex two true");
    expect(host.messages).toContain("can release ex three false");
    expect(host.messages).toContain("selected releases ex 1");
    expect(host.messages).toContain("selected releases 2");
    expect(host.messages).toContain("group excluded release check false");
    expect(host.messages).toContain("group excluded release selected 2");
    expect(host.messages).toContain("forced release check true");
    expect(host.messages).toContain("forced release selected 3 true");
    expect(host.messages).toContain("forced release ex max miss false");
    expect(host.messages).toContain("released 2");
    expect(host.messages).toContain("previous location true");
    expect(host.messages).toContain("previous controller true");
    expect(host.messages).toContain("release reason true/true");
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "graveyard" && (card.code === "100" || card.code === "300"))).toHaveLength(2);
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "500")?.location).toBe("monsterZone");
  });

  it("lets Lua scripts move cards to hand, deck, and extra deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Recoverable Monster", kind: "monster" },
      { code: "300", name: "Illegal Extra Return", kind: "monster" },
      { code: "301", name: "Pendulum Extra Return", kind: "monster", typeFlags: 0x1000001 },
      { code: "900", name: "Extra Return", kind: "extra" },
      { code: "901", name: "Extra Alias Return", kind: "extra" },
    ];
    const session = createDuel({ seed: 9, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "301"], extra: ["900", "901"] },
      1: { main: ["100", "300"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && (candidate.code === "100" || candidate.code === "300" || candidate.code === "301" || candidate.code === "900" || candidate.code === "901"))) {
      moveDuelCard(session.state, card.uid, "graveyard", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local recover = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to hand " .. Duel.SendtoHand(recover, 0, REASON_EFFECT))
      Debug.Message("operated hand " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local hand = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("to deck " .. Duel.SendtoDeck(hand, 0, 0, REASON_EFFECT))
      Debug.Message("operated deck " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to extra " .. Duel.SendtoExtraP(extra, 0, REASON_EFFECT))
      Debug.Message("operated extra " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("extra faceup " .. tostring(Duel.GetOperatedGroup():GetFirst():IsFaceup()))
      local extra_alias = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 901), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to extra alias " .. Duel.SendtoExtra(extra_alias, 0, REASON_EFFECT))
      Debug.Message("operated extra alias " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local pendulum = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("pendulum able extra " .. tostring(pendulum:GetFirst():IsAbleToExtra()))
      Debug.Message("to pendulum extra " .. Duel.SendtoExtraP(pendulum, 0, REASON_EFFECT))
      Debug.Message("pendulum extra faceup " .. tostring(Duel.GetOperatedGroup():GetFirst():IsFaceup()))
      local illegal = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("illegal extra " .. Duel.SendtoExtraP(illegal, 0, REASON_EFFECT))
      Debug.Message("operated illegal " .. Duel.GetOperatedGroup():GetCount())
      `,
      "movement-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("to hand 1");
    expect(host.messages).toContain("operated hand 100");
    expect(host.messages).toContain("to deck 1");
    expect(host.messages).toContain("operated deck 100");
    expect(host.messages).toContain("to extra 1");
    expect(host.messages).toContain("operated extra 900");
    expect(host.messages).toContain("extra faceup false");
    expect(host.messages).toContain("to extra alias 1");
    expect(host.messages).toContain("operated extra alias 901");
    expect(host.messages).toContain("pendulum able extra true");
    expect(host.messages).toContain("to pendulum extra 1");
    expect(host.messages).toContain("pendulum extra faceup true");
    expect(host.messages).toContain("illegal extra 0");
    expect(host.messages).toContain("operated illegal 0");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "100")?.location).toBe("deck");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "900")?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "301")).toMatchObject({ location: "extraDeck", faceUp: true });
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "300")?.location).toBe("graveyard");
  });

  it("lets Lua scripts inspect Xyz overlay materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Overlay Material A", kind: "monster" },
      { code: "300", name: "Overlay Material B", kind: "monster" },
      { code: "920", name: "Overlay Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 21, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: ["100", "300"] },
    });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const materials = session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid));

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local xyz = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local overlays = xyz:GetOverlayGroup()
      local first = overlays:GetFirst()
      local second = overlays:GetNext()
      Debug.Message("overlay count " .. xyz:GetOverlayCount() .. "/" .. overlays:GetCount())
      Debug.Message("overlay codes " .. first:GetCode() .. "/" .. second:GetCode())
      Debug.Message("card detach " .. xyz:RemoveOverlayCard(0, 1, 1, REASON_COST))
      Debug.Message("card detach operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("overlay after card detach " .. xyz:GetOverlayCount())
      Debug.Message("duel detach " .. Duel.RemoveOverlayCard(0, LOCATION_MZONE, 0, 1, 1, REASON_COST))
      Debug.Message("duel detach operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("overlay after duel detach " .. xyz:GetOverlayCount())
      Debug.Message("duel detach empty " .. Duel.RemoveOverlayCard(0, LOCATION_MZONE, 0, 1, 1, REASON_COST))
      Debug.Message("empty detach operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "overlay-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("overlay count 2/2");
    expect(host.messages).toContain("overlay codes 100/300");
    expect(host.messages).toContain("card detach 1");
    expect(host.messages).toContain("card detach operated 1/100");
    expect(host.messages).toContain("overlay after card detach 1");
    expect(host.messages).toContain("duel detach 1");
    expect(host.messages).toContain("duel detach operated 1/300");
    expect(host.messages).toContain("overlay after duel detach 0");
    expect(host.messages).toContain("duel detach empty 0");
    expect(host.messages).toContain("empty detach operated 0");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toEqual([]);
    expect(materials.every((card) => session.state.cards.find((candidate) => candidate.uid === card.uid)?.location === "graveyard")).toBe(true);
  });

  it("lets Lua effects pay Xyz overlay detach costs before resolving", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Detach Material A", kind: "monster" },
      { code: "300", name: "Detach Material B", kind: "monster" },
      { code: "920", name: "Detach Cost Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 30, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: ["100", "300"] },
    });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const materials = session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid));
    detachDuelOverlayMaterials(session.state, xyz!.uid, 1, 0);

    const remainingOverlayUid = session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids[0];
    const remainingOverlayCode = session.state.cards.find((card) => card.uid === remainingOverlayUid)?.code;
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c920={}
      function c920.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          local c=e:GetHandler()
          if chk==0 then
            Debug.Message("detach cost check " .. c:GetOverlayCount())
            return c:GetOverlayCount()>0
          end
          Debug.Message("detach cost pay " .. c:GetOverlayCount())
          return c:RemoveOverlayCard(tp,1,1,REASON_COST)==1
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("detach cost operation " .. e:GetHandler():GetOverlayCount())
        end)
        c:RegisterEffect(e)
      end
      `,
      "xyz-detach-cost.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(host.messages).toContain("detach cost check 1");
    const activation = applyResponse(session, action!);

    expect(activation.ok).toBe(true);
    expect(host.messages).toContain("detach cost pay 1");
    expect(host.messages).toContain("detach cost operation 0");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toEqual([]);
    expect(session.state.cards.find((card) => card.uid === remainingOverlayUid)).toMatchObject({ code: remainingOverlayCode, location: "graveyard" });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.uid === xyz!.uid)).toBe(false);
  });

  it("lets Lua scripts special summon face-up pendulum monsters from the extra deck", () => {
    const cards: DuelCardData[] = [
      { code: "301", name: "Lua Pendulum Return", kind: "monster", typeFlags: 0x1000001 },
      { code: "920", name: "Lua Face-Down Extra", kind: "extra", typeFlags: 0x800001, level: 4 },
    ];
    const session = createDuel({ seed: 31, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["301"], extra: ["920"] },
      1: { main: [] },
    });
    startDuel(session);

    const pendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    const extra = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    expect(pendulum).toBeTruthy();
    expect(extra).toBeTruthy();
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local pendulum = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      Debug.Message("pendulum can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, pendulum)))
      Debug.Message("extra can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, extra)))
      Debug.Message("pendulum special " .. Duel.SpecialSummon(pendulum, 0, 0, 0, false, false, POS_FACEUP_ATTACK))
      Debug.Message("pendulum operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("extra special " .. Duel.SpecialSummon(extra, 0, 0, 0, false, false, POS_FACEUP_ATTACK))
      Debug.Message("extra operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "pendulum-extra-special.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("pendulum can special true");
    expect(host.messages).toContain("extra can special false");
    expect(host.messages).toContain("pendulum special 1");
    expect(host.messages).toContain("pendulum operated 301");
    expect(host.messages).toContain("extra special 0");
    expect(host.messages).toContain("extra operated 0");
    expect(session.state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
    expect(session.state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "extraDeck", faceUp: false });
  });

  it("registers Lua special summon procedure effects as legal summon actions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Source", kind: "monster" },
      { code: "200", name: "Blocked Procedure Source", kind: "monster" },
      { code: "300", name: "Procedure Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 32, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_HAND, 0, 1, c)
        end)
        e:SetValue(function(e,c)
          Debug.Message("procedure value " .. c:GetCode())
          return c:IsCode(100)
        end)
        e:SetOperation(function(e,c)
          local g=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_HAND, 0, 1, 1, c)
          Debug.Message("procedure operation cost " .. g:GetCount())
          Duel.SendtoGrave(g, REASON_COST)
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetValue(function(e,c)
          Debug.Message("blocked procedure value " .. c:GetCode())
          return false
        end)
        c:RegisterEffect(e)
      end
      `,
      "special-summon-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid.includes("100"));
    const blocked = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid.includes("200"));
    expect(action).toBeDefined();
    expect(blocked).toBeUndefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("procedure value 100");
    expect(host.messages).toContain("blocked procedure value 200");
    expect(host.messages).toContain("procedure operation cost 1");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "specialSummonProcedure")).toBe(false);
  });

  it("supports Lua special summon procedures from face-up pendulum extra deck cards", () => {
    const cards: DuelCardData[] = [
      { code: "301", name: "Extra Procedure Pendulum", kind: "monster", typeFlags: 0x1000001 },
      { code: "920", name: "Blocked Extra Procedure", kind: "extra", typeFlags: 0x800001, level: 4 },
    ];
    const session = createDuel({ seed: 33, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["301"], extra: ["920"] },
      1: { main: [] },
    });
    startDuel(session);

    const pendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    const extra = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    expect(pendulum).toBeTruthy();
    expect(extra).toBeTruthy();
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c301={}
      function c301.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_EXTRA)
        e:SetValue(function(e,c)
          Debug.Message("extra procedure value " .. tostring(c:IsFaceup()) .. "/" .. c:GetLocation())
          return c:IsFaceup()
        end)
        e:SetOperation(function(e,c)
          Debug.Message("extra procedure operation " .. c:GetCode())
        end)
        c:RegisterEffect(e)
      end
      c920={}
      function c920.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_EXTRA)
        e:SetValue(function(e,c)
          Debug.Message("blocked extra procedure value " .. tostring(c:IsFaceup()) .. "/" .. c:GetLocation())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "extra-special-summon-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === pendulum!.uid);
    const blocked = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === extra!.uid);
    expect(action).toBeDefined();
    expect(blocked).toBeUndefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("extra procedure value true/64");
    expect(host.messages).toContain("extra procedure operation 301");
    expect(session.state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "extraDeck", faceUp: false });
  });

  it("lets Lua special summon procedures consume field materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material Procedure Source", kind: "monster" },
      { code: "200", name: "Blocked Material Procedure", kind: "monster" },
      { code: "300", name: "Procedure Field Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 34, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(material).toBeTruthy();
    moveDuelCard(session.state, material!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_MZONE, 0, 1, nil)
        end)
        e:SetOperation(function(e,c)
          local g=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_MZONE, 0, 1, 1, nil)
          Debug.Message("material procedure selected " .. g:GetCount() .. "/" .. g:GetFirst():GetCode())
          Duel.SendtoGrave(g, REASON_MATERIAL + REASON_SPSUMMON)
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 999), c:GetControler(), LOCATION_MZONE, 0, 1, nil)
        end)
        c:RegisterEffect(e)
      end
      `,
      "material-special-summon-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid.includes("100"));
    const blocked = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid.includes("200"));
    expect(action).toBeDefined();
    expect(blocked).toBeUndefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("material procedure selected 1/300");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "specialSummonProcedure")).toBe(false);
  });

  it("lets Lua special summon procedures free the last monster zone with materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Full Zone Procedure Source", kind: "monster" },
      { code: "200", name: "Full Zone Blocked Procedure", kind: "monster" },
      { code: "300", name: "Full Zone Material", kind: "monster" },
      { code: "400", name: "Zone Filler A", kind: "monster" },
      { code: "500", name: "Zone Filler B", kind: "monster" },
      { code: "600", name: "Zone Filler C", kind: "monster" },
      { code: "700", name: "Zone Filler D", kind: "monster" },
    ];
    const session = createDuel({ seed: 35, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600", "700"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["300", "400", "500", "600", "700"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const blockedSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(source).toBeTruthy();
    expect(blockedSource).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_MZONE, 0, nil)
          return g:GetCount()>0 and Duel.GetLocationCountFromEx(c:GetControler(), c:GetControler(), nil, g)>0
        end)
        e:SetOperation(function(e,c)
          local g=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_MZONE, 0, 1, 1, nil)
          Debug.Message("full zone material selected " .. g:GetCount() .. "/" .. Duel.GetLocationCountFromEx(c:GetControler(), c:GetControler(), nil, g))
          Duel.SendtoGrave(g, REASON_MATERIAL + REASON_SPSUMMON)
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.GetLocationCount(c:GetControler(), LOCATION_MZONE)>0
        end)
        c:RegisterEffect(e)
      end
      `,
      "full-zone-material-special-summon-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const actions = getDuelLegalActions(session, 0);
    const action = actions.find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    const blocked = actions.find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === blockedSource!.uid);
    expect(action).toBeDefined();
    expect(blocked).toBeUndefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("full zone material selected 1/1");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(5);
  });

  it("lets Lua special summon procedure costs release material before summoning", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Procedure Source", kind: "monster" },
      { code: "200", name: "Blocked Release Procedure", kind: "monster" },
      { code: "300", name: "Release Procedure Material", kind: "monster" },
      { code: "400", name: "Release Filler A", kind: "monster" },
      { code: "500", name: "Release Filler B", kind: "monster" },
      { code: "600", name: "Release Filler C", kind: "monster" },
      { code: "700", name: "Release Filler D", kind: "monster" },
    ];
    const session = createDuel({ seed: 36, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600", "700"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["300", "400", "500", "600", "700"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const blockedSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "monsterZone" && card.code === "300");
    expect(source).toBeTruthy();
    expect(blockedSource).toBeTruthy();
    expect(material).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.CheckReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 300), 1, e:GetHandler()) end
          local g=Duel.SelectReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 300), 1, 1, e:GetHandler())
          Debug.Message("procedure release cost " .. g:GetCount() .. "/" .. Duel.GetLocationCountFromEx(tp, tp, nil, g))
          Duel.Release(g, REASON_COST)
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.CheckReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 999), 1, e:GetHandler()) end
        end)
        c:RegisterEffect(e)
      end
      `,
      "release-cost-special-summon-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const actions = getDuelLegalActions(session, 0);
    const action = actions.find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    const blocked = actions.find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === blockedSource!.uid);
    expect(action).toBeDefined();
    expect(blocked).toBeUndefined();
    expect(host.messages).not.toContain("procedure release cost 1/1");
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "monsterZone" });
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("procedure release cost 1/1");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.uid === blockedSource!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(5);
  });

  it("lets Lua scripts query monster zones and choose summon positions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Zone Filler A", kind: "monster" },
      { code: "200", name: "Zone Filler B", kind: "monster" },
      { code: "300", name: "Zone Filler C", kind: "monster" },
      { code: "400", name: "Zone Filler D", kind: "monster" },
      { code: "500", name: "Zone Filler E", kind: "monster" },
      { code: "600", name: "Position Summon", kind: "monster" },
    ];
    const session = createDuel({ seed: 10, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    for (const code of ["100", "200", "300", "400", "500"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local excluded = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("location count " .. Duel.GetLocationCount(0, LOCATION_MZONE))
      Debug.Message("mzone count " .. Duel.GetMZoneCount(0))
      Debug.Message("mzone with excluded " .. Duel.GetMZoneCount(0, excluded))
      Debug.Message("ex count " .. Duel.GetLocationCountFromEx(0, 0, nil, excluded))
      Debug.Message("mzone seq0 open " .. tostring(Duel.CheckLocation(0, LOCATION_MZONE, 0)))
      Debug.Message("szone seq0 open " .. tostring(Duel.CheckLocation(0, LOCATION_SZONE, 0)))
      local selected = Duel.SelectPosition(0, nil, POS_FACEUP_DEFENSE + POS_FACEDOWN_DEFENSE)
      Debug.Message("selected position " .. selected)
      local summon = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil)
      local summon_card = summon:GetFirst()
      Debug.Message("can normal full " .. tostring(Duel.IsPlayerCanSummon(0, summon_card)))
      Debug.Message("can mset full " .. tostring(Duel.IsPlayerCanMSet(0, summon_card)))
      Debug.Message("can special full " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, selected, 0, summon_card)))
      Debug.Message("can special opponent " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, selected, 1, summon_card)))
      Debug.Message("summoned " .. Duel.SpecialSummon(summon, 0, 0, 1, false, false, selected))
      `,
      "summon-position.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("location count 0");
    expect(host.messages).toContain("mzone count 0");
    expect(host.messages).toContain("mzone with excluded 1");
    expect(host.messages).toContain("ex count 1");
    expect(host.messages).toContain("mzone seq0 open false");
    expect(host.messages).toContain("szone seq0 open true");
    expect(host.messages).toContain("selected position 4");
    expect(host.messages).toContain("can normal full false");
    expect(host.messages).toContain("can mset full false");
    expect(host.messages).toContain("can special full false");
    expect(host.messages).toContain("can special opponent true");
    expect(host.messages).toContain("summoned 1");
    const summoned = session.state.cards.find((card) => card.code === "600");
    expect(summoned?.controller).toBe(1);
    expect(summoned?.location).toBe("monsterZone");
    expect(summoned?.position).toBe("faceUpDefense");
  });

  it("lets Lua scripts inspect, confirm, and move deck-top groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Deck A", kind: "monster" },
      { code: "200", name: "Deck B", kind: "monster" },
      { code: "300", name: "Deck C", kind: "monster" },
      { code: "400", name: "Deck D", kind: "monster" },
    ];
    const session = createDuel({ seed: 11, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const expectedTop = session.state.cards
      .filter((card) => card.controller === 0 && card.location === "deck")
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, 2)
      .map((card) => card.code);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local top = Duel.GetDecktopGroup(0, 2)
      Debug.Message("top count " .. top:GetCount())
      local first = top:GetNext()
      local second = top:GetNext()
      Debug.Message("first top " .. first:GetCode())
      Debug.Message("second top " .. second:GetCode())
      Duel.ConfirmCards(1, top)
      Debug.Message("sent top " .. Duel.SendtoHand(top, 0, REASON_EFFECT))
      Duel.ShuffleDeck(0)
      `,
      "deck-top.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("top count 2");
    expect(host.messages).toContain(`first top ${expectedTop[0]}`);
    expect(host.messages).toContain(`second top ${expectedTop[1]}`);
    expect(host.messages).toContain(`confirmed 1: ${expectedTop.join(",")}`);
    expect(host.messages).toContain("sent top 2");
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && expectedTop.includes(card.code))).toHaveLength(2);
  });

  it("lets Lua scripts draw and search deck cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Draw A", kind: "monster" },
      { code: "200", name: "Draw B", kind: "monster" },
      { code: "300", name: "Search Target", kind: "monster" },
      { code: "400", name: "Draw C", kind: "monster" },
    ];
    const session = createDuel({ seed: 12, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const deckOrder = session.state.cards.filter((card) => card.controller === 0 && card.location === "deck").sort((a, b) => a.sequence - b.sequence);
    const drawnCodes = deckOrder.slice(0, 2).map((card) => card.code);
    const searchCode = deckOrder.slice(2).find((card) => card.code === "300")?.code ?? deckOrder[2]!.code;
    const discardedCode = deckOrder.slice(2).find((card) => card.code !== searchCode)!.code;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("can draw two " .. tostring(Duel.IsPlayerCanDraw(0, 2)))
      Debug.Message("can draw five " .. tostring(Duel.IsPlayerCanDraw(0, 5)))
      Debug.Message("drawn " .. Duel.Draw(0, 2, REASON_EFFECT))
      Debug.Message("draw operated " .. Duel.GetOperatedGroup():GetCount())
      local searched = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${searchCode}), 0, LOCATION_DECK, 0, 1, 1, nil)
      local searched_card = searched:GetFirst()
      Debug.Message("can grave searched " .. tostring(Duel.IsPlayerCanSendtoGrave(0, searched_card)))
      Debug.Message("can hand searched " .. tostring(Duel.IsPlayerCanSendtoHand(0, searched_card)))
      Debug.Message("can deck searched " .. tostring(Duel.IsPlayerCanSendtoDeck(0, searched_card)))
      Debug.Message("can remove searched " .. tostring(Duel.IsPlayerCanRemove(0, searched_card)))
      Debug.Message("can extra searched " .. tostring(Duel.IsPlayerCanSendtoExtra(0, searched_card)))
      Debug.Message("can special summon " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0)))
      Debug.Message("searched " .. Duel.SendtoHand(searched, 0, REASON_EFFECT))
      Debug.Message("search operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("can discard one " .. tostring(Duel.IsPlayerCanDiscardDeck(0, 1)))
      Debug.Message("can discard two " .. tostring(Duel.IsPlayerCanDiscardDeck(0, 2)))
      Debug.Message("discarded " .. Duel.DiscardDeck(0, 2, REASON_EFFECT))
      Debug.Message("discard operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("can hand discard three " .. tostring(Duel.IsPlayerCanDiscardHand(0, 3)))
      Debug.Message("can hand discard four " .. tostring(Duel.IsPlayerCanDiscardHand(0, 4)))
      Debug.Message("hand discarded " .. Duel.DiscardHand(0, aux.FilterBoolFunction(Card.IsCode, ${drawnCodes[0]}), 1, 1, REASON_EFFECT))
      Debug.Message("hand discard operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "draw-search.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("can draw two true");
    expect(host.messages).toContain("can draw five false");
    expect(host.messages).toContain("drawn 2");
    expect(host.messages).toContain("draw operated 2");
    expect(host.messages).toContain("can grave searched true");
    expect(host.messages).toContain("can hand searched true");
    expect(host.messages).toContain("can deck searched false");
    expect(host.messages).toContain("can remove searched true");
    expect(host.messages).toContain("can extra searched false");
    expect(host.messages).toContain("can special summon true");
    expect(host.messages).toContain("searched 1");
    expect(host.messages).toContain(`search operated ${searchCode}`);
    expect(host.messages).toContain("can discard one true");
    expect(host.messages).toContain("can discard two false");
    expect(host.messages).toContain("discarded 1");
    expect(host.messages).toContain(`discard operated 1/${discardedCode}`);
    expect(host.messages).toContain("can hand discard three true");
    expect(host.messages).toContain("can hand discard four false");
    expect(host.messages).toContain("hand discarded 1");
    expect(host.messages).toContain(`hand discard operated 1/${drawnCodes[0]}`);
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && drawnCodes.includes(card.code))).toHaveLength(1);
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === drawnCodes[0])?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === searchCode)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === discardedCode)?.location).toBe("graveyard");
  });

  it("lets Lua scripts query field groups across both players and locations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Self Grave", kind: "monster" },
      { code: "200", name: "Self Banished", kind: "monster" },
      { code: "300", name: "Opponent Grave", kind: "monster" },
      { code: "400", name: "Opponent Deck", kind: "monster" },
    ];
    const session = createDuel({ seed: 13, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 0 && card.code === "100")!.uid, "graveyard", 0);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 0 && card.code === "200")!.uid, "banished", 0);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 1 && card.code === "300")!.uid, "graveyard", 1);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 1 && card.code === "400")!.uid, "deck", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local mixed = Duel.GetFieldGroup(0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK)
      Debug.Message("mixed count " .. mixed:GetCount())
      Debug.Message("field count " .. Duel.GetFieldGroupCount(0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK))
      Debug.Message("banished count " .. Duel.GetMatchingGroupCount(Card.IsAbleToGrave, 0, LOCATION_REMOVED, 0, nil))
      local first = mixed:GetNext()
      local second = mixed:GetNext()
      local third = mixed:GetNext()
      local fourth = mixed:GetNext()
      Debug.Message("mixed codes " .. first:GetCode() .. "," .. second:GetCode() .. "," .. third:GetCode() .. "," .. fourth:GetCode())
      local own_grave = Duel.GetFieldCard(0, LOCATION_GRAVE, 0)
      local opponent_deck = Duel.GetFieldCard(1, LOCATION_DECK, 0)
      local empty = Duel.GetFieldCard(0, LOCATION_GRAVE, 3)
      Debug.Message("field card codes " .. own_grave:GetCode() .. "/" .. opponent_deck:GetCode() .. "/" .. tostring(empty == nil))
      local function match(c, code)
        return c:IsCode(code)
      end
      local first_match = Duel.GetFirstMatchingCard(match, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, nil, 300)
      Debug.Message("first matching card " .. first_match:GetCode())
      local excluded = Duel.GetMatchingGroup(function(c) return c:IsCode(100) or c:IsCode(300) end, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, nil)
      local group_excluded = Duel.GetMatchingGroup(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded)
      Debug.Message("group excluded count " .. group_excluded:GetCount())
      Debug.Message("group excluded matching count " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded))
      Debug.Message("matching target alias count " .. Duel.GetMatchingTargetCount(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded))
      Debug.Message("matching target alias group " .. Duel.GetMatchingTarget(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded):GetCount())
      Debug.Message("group excluded exists " .. tostring(Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, 1, excluded)))
      Debug.Message("group excluded first " .. Duel.GetFirstMatchingCard(aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, excluded):GetCode())
      Debug.Message("group excluded selected " .. Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, 1, 3, excluded):GetCount())
      Debug.Message("group excluded selected too few " .. Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, 3, 3, excluded):GetCount())
      Debug.Message("group excluded selected unbounded " .. Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, 1, 0, excluded):GetCount())
      Debug.Message("onfield count " .. Duel.GetFieldGroupCount(0, LOCATION_ONFIELD, LOCATION_ONFIELD))
      `,
      "field-groups.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("mixed count 4");
    expect(host.messages).toContain("field count 4");
    expect(host.messages).toContain("banished count 1");
    expect(host.messages).toContain("mixed codes 100,200,300,400");
    expect(host.messages).toContain("field card codes 100/400/true");
    expect(host.messages).toContain("first matching card 300");
    expect(host.messages).toContain("group excluded count 2");
    expect(host.messages).toContain("group excluded matching count 2");
    expect(host.messages).toContain("matching target alias count 2");
    expect(host.messages).toContain("matching target alias group 2");
    expect(host.messages).toContain("group excluded exists false");
    expect(host.messages).toContain("group excluded first 200");
    expect(host.messages).toContain("group excluded selected 2");
    expect(host.messages).toContain("group excluded selected too few 0");
    expect(host.messages).toContain("group excluded selected unbounded 2");
    expect(host.messages).toContain("onfield count 0");
  });

  it("lets Lua scripts read card type, stats, race, and attribute", () => {
    const cards: DuelCardData[] = [
      { code: "100", alias: "900", name: "Stat Monster", kind: "monster", typeFlags: 0x21, attack: 2500, defense: 2100, level: 7, race: 0x2, attribute: 0x20 },
      { code: "200", name: "Fixture Spell", kind: "spell", typeFlags: 0x2 },
      { code: "300", name: "Rank Fixture", kind: "monster", typeFlags: 0x800001, attack: 1800, defense: 1200, level: 4 },
      { code: "400", name: "Link Fixture", kind: "monster", typeFlags: 0x4000001, attack: 1500, level: 2, linkMarkers: 0x5 },
    ];
    const session = createDuel({ seed: 14, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monsters = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local c = monsters:GetFirst()
      Debug.Message("type " .. c:GetType())
      Debug.Message("stats " .. c:GetAttack() .. "/" .. c:GetDefense() .. "/" .. c:GetLevel())
      Debug.Message("stat predicates " .. tostring(c:IsAttack(2500)) .. "/" .. tostring(c:IsDefense(2100)) .. "/" .. tostring(c:IsLevel(7)))
      Debug.Message("code checks " .. tostring(c:IsCode(900)) .. "/" .. tostring(c:IsOriginalCode(900)) .. "/" .. tostring(c:IsOriginalCode(100)))
      local xyz = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local link = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("rank " .. xyz:GetRank() .. "/" .. xyz:GetOriginalRank() .. "/" .. tostring(xyz:IsRank(4)))
      Debug.Message("link " .. link:GetLink() .. "/" .. link:GetOriginalLink() .. "/" .. link:GetLinkMarker() .. "/" .. tostring(link:IsLink(2)))
      Debug.Message("race " .. c:GetRace() .. " " .. tostring(c:IsRace(RACE_SPELLCASTER)))
      Debug.Message("attribute " .. c:GetAttribute() .. " " .. tostring(c:IsAttribute(ATTRIBUTE_DARK)))
      Debug.Message("spell count " .. Duel.GetMatchingGroupCount(aux.FilterBoolFunction(Card.IsType, TYPE_SPELL), 0, LOCATION_HAND, 0, nil))
      `,
      "card-stats.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("type 33");
    expect(host.messages).toContain("stats 2500/2100/7");
    expect(host.messages).toContain("stat predicates true/true/true");
    expect(host.messages).toContain("code checks true/false/true");
    expect(host.messages).toContain("rank 4/4/true");
    expect(host.messages).toContain("link 2/2/5/true");
    expect(host.messages).toContain("race 2 true");
    expect(host.messages).toContain("attribute 32 true");
    expect(host.messages).toContain("spell count 1");
  });

  it("passes extra filter arguments through Lua matching helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Vararg A", kind: "monster", attack: 1600 },
      { code: "200", name: "Vararg B", kind: "monster", attack: 900 },
      { code: "300", name: "Vararg C", kind: "monster", attack: 2000 },
    ];
    const session = createDuel({ seed: 23, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const handResult = host.loadScript(
      `
      local function match(c, code, minatk)
        return c:IsCode(code) and c:GetAttack() >= minatk
      end
      local selected = Duel.SelectMatchingCard(0, match, 0, LOCATION_HAND, 0, 1, 1, nil, 100, 1500)
      Debug.Message("vararg selected " .. selected:GetFirst():GetCode())
      Debug.Message("vararg count " .. Duel.GetMatchingGroupCount(match, 0, LOCATION_HAND, 0, nil, 300, 1800))
      Debug.Message("vararg existing " .. tostring(Duel.IsExistingMatchingCard(match, 0, LOCATION_HAND, 0, 1, nil, 200, 1000)))
      Debug.Message("duel sum check " .. tostring(Duel.CheckWithSumEqual(Card.GetAttack, 0, LOCATION_HAND, 0, 2500, 2, 2, nil)))
      Debug.Message("duel sum miss " .. tostring(Duel.CheckWithSumEqual(Card.GetAttack, 0, LOCATION_HAND, 0, 4500, 2, 2, nil)))
      Debug.Message("duel sum greater check " .. tostring(Duel.CheckWithSumGreater(Card.GetAttack, 0, LOCATION_HAND, 0, 3500, 2, 2, nil)))
      Debug.Message("duel sum greater miss " .. tostring(Duel.CheckWithSumGreater(Card.GetAttack, 0, LOCATION_HAND, 0, 5500, 2, 2, nil)))
      local sum_selected = Duel.SelectWithSumEqual(0, Card.GetAttack, 0, LOCATION_HAND, 0, 3600, 2, 2, nil)
      Debug.Message("duel sum selected " .. sum_selected:GetCount())
      local sum_greater_selected = Duel.SelectWithSumGreater(0, Card.GetAttack, 0, LOCATION_HAND, 0, 3500, 2, 2, nil)
      Debug.Message("duel sum greater selected " .. sum_greater_selected:GetCount())
      local vararg_sum = Duel.SelectWithSumEqual(0, function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 0, LOCATION_HAND, 0, 3600, 2, 2, nil, 1500)
      Debug.Message("duel sum vararg " .. vararg_sum:GetCount())
      local vararg_greater_sum = Duel.SelectWithSumGreater(0, function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 0, LOCATION_HAND, 0, 3500, 2, 2, nil, 1500)
      Debug.Message("duel sum greater vararg " .. vararg_greater_sum:GetCount())
      local function subgroup_attack(sg,minatk)
        local total=0
        local tc=sg:GetFirst()
        while tc do
          total=total+tc:GetAttack()
          tc=sg:GetNext()
        end
        return total>=minatk
      end
      Debug.Message("duel subgroup check " .. tostring(Duel.CheckSubGroup(subgroup_attack, 0, LOCATION_HAND, 0, 2, 2, nil, 3500)))
      Debug.Message("duel subgroup miss " .. tostring(Duel.CheckSubGroup(subgroup_attack, 0, LOCATION_HAND, 0, 2, 2, nil, 5000)))
      local subgroup = Duel.SelectSubGroup(0, subgroup_attack, false, 0, LOCATION_HAND, 0, 2, 2, nil, 3500)
      Debug.Message("duel subgroup selected " .. subgroup:GetCount())
      `,
      "matching-varargs.lua",
    );

    expect(handResult.ok).toBe(true);
    expect(host.messages).toContain("vararg selected 100");
    expect(host.messages).toContain("vararg count 1");
    expect(host.messages).toContain("vararg existing false");
    expect(host.messages).toContain("duel sum check true");
    expect(host.messages).toContain("duel sum miss false");
    expect(host.messages).toContain("duel sum greater check true");
    expect(host.messages).toContain("duel sum greater miss false");
    expect(host.messages).toContain("duel sum selected 2");
    expect(host.messages).toContain("duel sum greater selected 2");
    expect(host.messages).toContain("duel sum vararg 2");
    expect(host.messages).toContain("duel sum greater vararg 2");
    expect(host.messages).toContain("duel subgroup check true");
    expect(host.messages).toContain("duel subgroup miss false");
    expect(host.messages).toContain("duel subgroup selected 2");

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }
    const releaseResult = host.loadScript(
      `
      local function release_filter(c, minatk)
        return c:GetAttack() >= minatk
      end
      Debug.Message("vararg release check " .. tostring(Duel.CheckReleaseGroup(0, release_filter, 2, nil, 1500)))
      Debug.Message("vararg release ex check " .. tostring(Duel.CheckReleaseGroupEx(0, release_filter, 2, 2, nil, 1500)))
      local g = Duel.SelectReleaseGroup(0, release_filter, 1, 2, nil, 1500)
      Debug.Message("vararg release selected " .. g:GetCount())
      local gx = Duel.SelectReleaseGroupEx(0, release_filter, 1, 1, nil, 1500)
      Debug.Message("vararg release ex selected " .. gx:GetCount())
      `,
      "release-varargs.lua",
    );

    expect(releaseResult.ok).toBe(true);
    expect(host.messages).toContain("vararg release check true");
    expect(host.messages).toContain("vararg release ex check true");
    expect(host.messages).toContain("vararg release selected 2");
    expect(host.messages).toContain("vararg release ex selected 1");
  });

  it("lets Lua scripts mutate and filter groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Group A", kind: "monster", attack: 1000 },
      { code: "200", name: "Group B", kind: "monster", attack: 2000 },
      { code: "300", name: "Group C", kind: "monster", attack: 3000 },
    ];
    const session = createDuel({ seed: 15, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local all = Duel.GetFieldGroup(0, LOCATION_HAND, 0)
      local high = all:Filter(function(tc) return tc:GetAttack() >= 2000 end, nil)
      local vararg_high = all:Filter(function(tc,minatk) return tc:GetAttack() >= minatk end, nil, 2500)
      local c100 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c200 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c300 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local excluded_group = Group.FromCards(c200)
      local without_c200 = all:Filter(function(tc,minatk) return tc:GetAttack() >= minatk end, excluded_group, 1000)
      local g = Group.CreateGroup()
      g:AddCard(c100)
      g:AddCard(c100)
      g:KeepAlive()
      Debug.Message("added unique " .. g:GetCount() .. " " .. tostring(g:IsContains(c100)))
      Debug.Message("contains alias " .. tostring(g:Contains(c100)) .. "/" .. tostring(g:Contains(c200)))
      g:Merge(high)
      Debug.Message("merged " .. g:GetCount() .. " " .. tostring(g:IsContains(c200)))
      local from_cards = Group.FromCards(c100, c200, c100)
      Debug.Message("from cards " .. from_cards:GetCount() .. " " .. tostring(from_cards:Equal(Group.FromCards(c200, c100))))
      local without_high = g:Clone()
      without_high:Sub(high)
      Debug.Message("sub high " .. without_high:GetCount() .. " " .. tostring(without_high:IsContains(c100)))
      without_high:Clear()
      Debug.Message("clear group " .. without_high:GetCount())
      local clone = g:Clone()
      local selected = clone:Select(0, 1, 2, nil)
      Debug.Message("selected group " .. selected:GetCount())
      Debug.Message("selected group too few " .. clone:Select(0, 4, 4, nil):GetCount())
      Debug.Message("selected group unbounded " .. clone:Select(0, 1, 0, nil):GetCount())
      local sorted = Group.FromCards(c300, c100, c200)
      sorted:Sort(function(a,b) return a:GetAttack()<b:GetAttack() end)
      Debug.Message("sorted asc " .. sorted:GetFirst():GetCode() .. "/" .. sorted:GetNext():GetCode() .. "/" .. sorted:GetNext():GetCode())
      local sorted_desc = Group.FromCards(c100, c200, c300)
      sorted_desc:Sort(function(a,b,desc) if desc then return a:GetAttack()>b:GetAttack() end return a:GetAttack()<b:GetAttack() end, true)
      Debug.Message("sorted desc " .. sorted_desc:GetFirst():GetCode() .. "/" .. sorted_desc:GetNext():GetCode() .. "/" .. sorted_desc:GetNext():GetCode())
      local select_pool = Group.FromCards(c100)
      local added = all:SelectUnselect(select_pool, true, false, 1, 2)
      Debug.Message("select unselect add " .. tostring(added and added:GetCode()))
      select_pool:AddCard(added)
      local stopped = all:SelectUnselect(select_pool, true, false, 1, 2)
      Debug.Message("select unselect stop " .. tostring(stopped == nil))
      local unbounded = all:SelectUnselect(Group.CreateGroup(), true, false, 1, 0)
      Debug.Message("select unselect unbounded " .. tostring(unbounded and unbounded:GetCode()))
      Debug.Message("exists high " .. tostring(all:IsExists(function(tc,minatk) return tc:GetAttack() >= minatk end, 2, nil, 1500)))
      Debug.Message("filter group excluded " .. without_c200:GetCount() .. " " .. tostring(without_c200:IsContains(c200)))
      Debug.Message("filter count alias " .. all:FilterCount(function(tc,minatk) return tc:GetAttack() >= minatk end, excluded_group, 1000))
      Debug.Message("exists group excluded " .. tostring(all:IsExists(aux.FilterBoolFunction(Card.IsCode, 200), 1, excluded_group)))
      Debug.Message("exists group remainder " .. tostring(all:IsExists(function(tc,minatk) return tc:GetAttack() >= minatk end, 1, excluded_group, 2500)))
      Debug.Message("class count " .. all:GetClassCount(function(tc) return tc:GetAttack() >= 2000 and 1 or 0 end))
      Debug.Message("sum exact " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 3000, 2, 2)))
      Debug.Message("sum miss " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 4500, 2, 2)))
      Debug.Message("sum greater " .. tostring(all:CheckWithSumGreater(Card.GetAttack, 3500, 2, 2)))
      Debug.Message("sum greater miss " .. tostring(all:CheckWithSumGreater(Card.GetAttack, 5500, 2, 2)))
      local sum_selected = all:SelectWithSumEqual(0, Card.GetAttack, 3000, 2, 2)
      Debug.Message("sum selected " .. sum_selected:GetCount())
      local sum_greater_selected = all:SelectWithSumGreater(0, Card.GetAttack, 3500, 2, 2)
      Debug.Message("sum greater selected " .. sum_greater_selected:GetCount())
      Duel.SetSelectedCard(c300)
      Debug.Message("forced sum exact miss " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 3000, 2, 2)))
      Duel.SetSelectedCard(c100)
      Debug.Message("forced sum greater miss " .. tostring(all:CheckWithSumGreater(Card.GetAttack, 4500, 2, 2)))
      Duel.SetSelectedCard(c200)
      local forced_sum = all:SelectWithSumGreater(0, Card.GetAttack, 4500, 2, 2)
      Debug.Message("forced sum greater selected " .. forced_sum:GetCount() .. " " .. tostring(forced_sum:IsContains(c200)))
      Duel.SetSelectedCard(nil)
      Debug.Message("forced sum cleared " .. tostring(all:CheckWithSumEqual(Card.GetAttack, 3000, 2, 2)))
      local vararg_sum = all:SelectWithSumEqual(0, function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 5000, 2, 2, 1500)
      Debug.Message("sum vararg " .. vararg_sum:GetCount())
      local vararg_greater_sum = all:SelectWithSumGreater(0, function(tc,minatk) return tc:GetAttack() >= minatk and tc:GetAttack() or 0 end, 4500, 2, 2, 1500)
      Debug.Message("sum greater vararg " .. vararg_greater_sum:GetCount())
      local function subgroup_attack(sg,minatk)
        local total=0
        local tc=sg:GetFirst()
        while tc do
          total=total+tc:GetAttack()
          tc=sg:GetNext()
        end
        return total>=minatk
      end
      Debug.Message("subgroup check " .. tostring(all:CheckSubGroup(subgroup_attack, 2, 2, 4000)))
      Debug.Message("subgroup miss " .. tostring(all:CheckSubGroup(subgroup_attack, 2, 2, 6000)))
      local subgroup = all:SelectSubGroup(0, subgroup_attack, false, 2, 2, 4000)
      Debug.Message("subgroup selected " .. subgroup:GetCount())
      Duel.SetSelectedCard(c300)
      local forced_subgroup = all:SelectSubGroup(0, subgroup_attack, false, 2, 2, 4000)
      Debug.Message("forced subgroup selected " .. forced_subgroup:GetCount() .. " " .. tostring(forced_subgroup:IsContains(c300)))
      Duel.SetSelectedCard(nil)
      local picked_subgroup = all:SelectUnselectSubGroup(Group.FromCards(c100), 0, false, 2, 2, subgroup_attack, 5000)
      Debug.Message("select unselect subgroup " .. picked_subgroup:GetCount() .. " " .. tostring(picked_subgroup:IsContains(c100)))
      local missed_subgroup = all:SelectUnselectSubGroup(Group.FromCards(c100), 0, false, 2, 2, subgroup_attack, 6000)
      Debug.Message("select unselect subgroup miss " .. missed_subgroup:GetCount())
      local plain_subgroup = all:SelectUnselectSubGroup(Group.FromCards(c100), 0, false, 1, 0)
      Debug.Message("select unselect subgroup plain " .. plain_subgroup:GetCount() .. " " .. tostring(plain_subgroup:IsContains(c100)))
      g:RemoveCard(c100)
      g:DeleteGroup()
      Debug.Message("removed " .. g:GetCount() .. " " .. tostring(g:IsContains(c100)))
      Debug.Message("filtered high " .. high:GetCount())
      Debug.Message("vararg high " .. vararg_high:GetCount())
      `,
      "group-mutation.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("added unique 1 true");
    expect(host.messages).toContain("contains alias true/false");
    expect(host.messages).toContain("merged 3 true");
    expect(host.messages).toContain("from cards 2 true");
    expect(host.messages).toContain("sub high 1 true");
    expect(host.messages).toContain("clear group 0");
    expect(host.messages).toContain("selected group 2");
    expect(host.messages).toContain("selected group too few 0");
    expect(host.messages).toContain("selected group unbounded 3");
    expect(host.messages).toContain("sorted asc 100/200/300");
    expect(host.messages).toContain("sorted desc 300/200/100");
    expect(host.messages).toContain("select unselect add 200");
    expect(host.messages).toContain("select unselect stop true");
    expect(host.messages).toContain("select unselect unbounded 200");
    expect(host.messages).toContain("exists high true");
    expect(host.messages).toContain("filter group excluded 2 false");
    expect(host.messages).toContain("filter count alias 2");
    expect(host.messages).toContain("exists group excluded false");
    expect(host.messages).toContain("exists group remainder true");
    expect(host.messages).toContain("class count 2");
    expect(host.messages).toContain("sum exact true");
    expect(host.messages).toContain("sum miss false");
    expect(host.messages).toContain("sum greater true");
    expect(host.messages).toContain("sum greater miss false");
    expect(host.messages).toContain("sum selected 2");
    expect(host.messages).toContain("sum greater selected 2");
    expect(host.messages).toContain("forced sum exact miss false");
    expect(host.messages).toContain("forced sum greater miss false");
    expect(host.messages).toContain("forced sum greater selected 2 true");
    expect(host.messages).toContain("forced sum cleared true");
    expect(host.messages).toContain("sum vararg 2");
    expect(host.messages).toContain("sum greater vararg 2");
    expect(host.messages).toContain("subgroup check true");
    expect(host.messages).toContain("subgroup miss false");
    expect(host.messages).toContain("subgroup selected 2");
    expect(host.messages).toContain("forced subgroup selected 2 true");
    expect(host.messages).toContain("select unselect subgroup 2 false");
    expect(host.messages).toContain("select unselect subgroup miss 0");
    expect(host.messages).toContain("select unselect subgroup plain 2 false");
    expect(host.messages).toContain("removed 2 false");
    expect(host.messages).toContain("filtered high 2");
    expect(host.messages).toContain("vararg high 1");
  });

  it("stores Lua effect metadata setters on registered effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Metadata Source", kind: "monster" }];
    const session = createDuel({ seed: 16, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetDescription(1234)
        e:SetCategory(CATEGORY_DRAW + CATEGORY_SEARCH)
        e:SetProperty(EFFECT_FLAG_CARD_TARGET + EFFECT_FLAG_DELAY)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(LOCATION_MZONE, LOCATION_GRAVE)
        e:SetHintTiming(TIMING_END_PHASE, TIMING_MAIN_END)
        e:SetCountLimit(2, 987)
        e:SetReset(RESET_EVENT + RESETS_STANDARD, 1)
        e:SetCondition(function(e,c) return c:IsCode(100) end)
        e:SetCost(function(e,c) return true end)
        e:SetTarget(function(e,c) return true end)
        e:SetOperation(function(e,c) Debug.Message("metadata operation") end)
        local condition=e:GetCondition()
        local cost=e:GetCost()
        local target=e:GetTarget()
        local operation=e:GetOperation()
        Debug.Message("effect predicates " .. tostring(e:IsHasType(EFFECT_TYPE_IGNITION)) .. "/" .. tostring(e:IsHasCategory(CATEGORY_DRAW)) .. "/" .. tostring(e:IsHasProperty(EFFECT_FLAG_CARD_TARGET)))
        Debug.Message("effect callbacks " .. tostring(condition(e,c)) .. "/" .. tostring(cost(e,c)) .. "/" .. tostring(target(e,c)) .. "/" .. tostring(operation ~= nil))
        e:SetValue(function(e,c) return c:GetCode()+7 end)
        local value_fn=e:GetValue()
        Debug.Message("effect value function " .. value_fn(e,c))
        e:SetValue(2500)
        local own_range,opponent_range=e:GetTargetRange()
        local limit,limit_code=e:GetCountLimit()
        local reset,reset_count=e:GetReset()
        Debug.Message("effect getters " .. e:GetType() .. "/" .. e:GetCode() .. "/" .. e:GetDescription() .. "/" .. e:GetCategory() .. "/" .. e:GetProperty() .. "/" .. e:GetRange())
        Debug.Message("effect target range " .. own_range .. "/" .. opponent_range)
        Debug.Message("effect count reset " .. limit .. "/" .. limit_code .. "/" .. reset .. "/" .. reset_count)
        Debug.Message("effect value number " .. e:GetValue())
        c:RegisterEffect(e)
      end
      `,
      "effect-metadata.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("EFFECT_TYPE_SINGLE")).toBe(0x1);
    expect(host.getGlobalNumber("EFFECT_TYPE_IGNITION")).toBe(0x40);
    expect(host.getGlobalNumber("EFFECT_TYPE_TRIGGER_O")).toBe(0x80);
    expect(host.getGlobalNumber("EFFECT_TYPE_CONTINUOUS")).toBe(0x800);
    expect(host.getGlobalNumber("CATEGORY_DISABLE")).toBe(0x4000);
    expect(host.getGlobalNumber("CATEGORY_NEGATE")).toBe(0x10000000);
    expect(host.getGlobalNumber("EFFECT_FLAG_DAMAGE_STEP")).toBe(0x4000);
    expect(host.getGlobalNumber("EFFECT_FLAG_DAMAGE_CAL")).toBe(0x8000);
    expect(host.getGlobalNumber("EFFECT_FLAG_PLAYER_TARGET")).toBe(0x800);
    expect(host.getGlobalNumber("EFFECT_FLAG_IMMEDIATELY_APPLY")).toBe(0x80000000);
    expect(host.getGlobalNumber("HINT_SELECTMSG")).toBe(3);
    expect(host.getGlobalNumber("HINTMSG_TOHAND")).toBe(506);
    expect(host.getGlobalNumber("HINTMSG_TARGET")).toBe(551);
    expect(host.getGlobalNumber("PHASE_MAIN1")).toBe(0x4);
    expect(host.getGlobalNumber("PHASE_BATTLE")).toBe(0x80);
    expect(host.getGlobalNumber("EVENT_SUMMON_SUCCESS")).toBe(1100);
    expect(host.getGlobalNumber("EVENT_TO_GRAVE")).toBe(1014);
    expect(host.getGlobalNumber("EVENT_CHAINING")).toBe(1027);
    expect(host.getGlobalNumber("RESETS_STANDARD")).toBe(0x1fe0000);
    expect(host.getGlobalNumber("RESET_PHASE")).toBe(0x40000000);
    expect(host.getGlobalNumber("RESET_CHAIN")).toBe(0x80000000);
    expect(host.getGlobalNumber("REASON_LINK")).toBe(0x10000000);
    expect(host.getGlobalNumber("REASON_DRAW")).toBe(0x2000000);
    expect(host.registerInitialEffects()).toBe(2);
    expect(host.messages).toContain("effect predicates true/true/true");
    expect(host.messages).toContain("effect callbacks true/true/true/true");
    expect(host.messages).toContain("effect value function 107");
    expect(host.messages).toContain("effect getters 64/1100/1234/196608/65552/2");
    expect(host.messages).toContain("effect target range 4/16");
    expect(host.messages).toContain("effect count reset 2/987/33427456/1");
    expect(host.messages).toContain("effect value number 2500");
    expect(session.state.effects[0]).toMatchObject({
      triggerEvent: "normalSummoned",
      range: ["hand"],
      description: 1234,
      category: 0x30000,
      property: 0x10010,
      targetRange: [0x04, 0x10],
      hintTiming: [0x20, 0x4],
      countLimit: 2,
      countLimitCode: 987,
      reset: { flags: 0x1fe1000, count: 1 },
    });
  });

  it("lets Lua effects clone metadata and override callbacks independently", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Clone Source", kind: "monster" },
      { code: "200", name: "Other Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 27, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
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
        e:SetDescription(111)
        e:SetLabel(5)
        e:SetValue(10)
        e:SetOperation(function(e,c)
          Debug.Message("base op " .. e:GetDescription() .. "/" .. e:GetLabel() .. "/" .. e:GetValue() .. "/" .. e:GetActivateLocation() .. "/" .. e:GetActivateSequence())
        end)
        local e2=e:Clone()
        Debug.Message("clone initial " .. e2:GetDescription() .. "/" .. e2:GetLabel() .. "/" .. e2:GetValue() .. "/" .. e2:GetRange() .. "/" .. e2:GetOwner():GetCode() .. "/" .. e2:GetActivateLocation() .. "/" .. e2:GetActivateSequence())
        e2:SetDescription(222)
        e2:SetLabel(9)
        e2:SetValue(20)
        e2:SetOperation(function(e,c)
          Debug.Message("clone op " .. e:GetDescription() .. "/" .. e:GetLabel() .. "/" .. e:GetValue() .. "/" .. e:GetActivateLocation() .. "/" .. e:GetActivateSequence())
        end)
        c:RegisterEffect(e)
        c:RegisterEffect(e2)
      end
      `,
      "effect-clone.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toContain("clone initial 111/5/10/2/100/2/0");
    expect(session.state.effects).toHaveLength(2);
    expect(session.state.effects[0]).toMatchObject({ description: 111, range: ["hand"] });
    expect(session.state.effects[1]).toMatchObject({ description: 222, range: ["hand"] });

    const baseAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === session.state.effects[0]?.id);
    expect(baseAction).toBeDefined();
    expect(applyResponse(session, baseAction!).ok).toBe(true);
    const cloneAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === session.state.effects[1]?.id);
    expect(cloneAction).toBeDefined();
    expect(applyResponse(session, cloneAction!).ok).toBe(true);

    expect(host.messages).toContain("base op 111/5/10/2/0");
    expect(host.messages).toContain("clone op 222/9/20/2/0");
  });

  it("stores Lua effect owner player metadata and deletes registered effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Lifecycle Source", kind: "monster" }];
    const session = createDuel({ seed: 28, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
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
        e:SetOwnerPlayer(1)
        Debug.Message("owner player " .. e:GetOwnerPlayer())
        c:RegisterEffect(e)
        local e2=e:Clone()
        e2:SetOwnerPlayer(0)
        e2:SetOperation(function(e,c)
          Debug.Message("deleted clone should not resolve")
        end)
        c:RegisterEffect(e2)
        Debug.Message("clone owner " .. e2:GetOwnerPlayer())
        e2:Delete()
      end
      `,
      "effect-lifecycle.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toContain("owner player 1");
    expect(host.messages).toContain("clone owner 0");
    expect(session.state.effects).toHaveLength(1);
    expect(session.state.effects[0]).toMatchObject({ controller: 1, ownerPlayer: 1 });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
  });

  it("passes chk values to upstream-style Lua cost and target callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Check Source", kind: "monster" },
      { code: "200", name: "Check Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 29, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
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
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then
            Debug.Message("cost check " .. tp)
            return true
          end
          Debug.Message("cost activate " .. chk)
          return true
        end)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then
            Debug.Message("target check " .. tp)
            return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, e:GetHandler())
          end
          Debug.Message("target activate " .. chk)
          local g=Duel.SelectTarget(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, e:GetHandler())
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), tp, 0)
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("operation target " .. Duel.GetFirstTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "effect-chk.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(host.messages).toContain("cost check 0");
    expect(host.messages).toContain("target check 0");
    expect(host.messages).not.toContain("target activate 0");
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("cost activate 1");
    expect(host.messages).toContain("target activate 1");
    expect(host.messages).toContain("operation target 200");
  });

  it("shares Lua keyed count limits across effect copies", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Count Source", kind: "monster" }];
    const session = createDuel({ seed: 21, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "100"] },
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
        e:SetCountLimit(1, 700)
        e:SetOperation(function(e,c)
          Debug.Message("used " .. c:GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "keyed-count-limit.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const firstAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(firstAction).toBeDefined();
    applyResponse(session, firstAction!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("used 100");
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
  });

  it("lets Lua effects pass labels and label objects between callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Label Source", kind: "monster" },
      { code: "200", name: "Label Object", kind: "monster" },
    ];
    const session = createDuel({ seed: 17, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
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
        e:SetLabel(7)
        e:SetTarget(function(e,c)
          Debug.Message("target label " .. e:GetLabel())
          e:SetLabel(e:GetLabel()+1)
          local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          e:SetLabelObject(g)
          return true
        end)
        e:SetOperation(function(e,c)
          local g=e:GetLabelObject()
          Debug.Message("operation label " .. e:GetLabel())
          Debug.Message("label object count " .. g:GetCount())
        end)
        c:RegisterEffect(e)
      end
      `,
      "effect-labels.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("target label 7");
    expect(host.messages).toContain("operation label 8");
    expect(host.messages).toContain("label object count 1");
  });

  it("lets Lua effects share operation info between target and operation callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Operation Source", kind: "monster" },
      { code: "200", name: "Operation Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 20, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
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
          Duel.Hint(HINT_SELECTMSG, 0, HINTMSG_TOHAND)
          local g=Duel.SelectTarget(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), 0, 0)
          Duel.SetPossibleOperationInfo(0, CATEGORY_DRAW, nil, 0, 1, 2)
          return true
        end)
        e:SetOperation(function(e,c)
          local ok,cat,g,count,p,param=Duel.GetOperationInfo(0, CATEGORY_TOHAND)
          Debug.Message("operation info " .. tostring(ok) .. "/" .. cat .. "/" .. g:GetCount() .. "/" .. count .. "/" .. p .. "/" .. param)
          local possible,pcat,pg,pcount,pp,pparam=Duel.GetPossibleOperationInfo(0, CATEGORY_DRAW)
          Debug.Message("possible operation info " .. tostring(possible) .. "/" .. pcat .. "/" .. pg:GetCount() .. "/" .. pcount .. "/" .. pp .. "/" .. pparam)
          local committed_draw=Duel.GetOperationInfo(0, CATEGORY_DRAW)
          Debug.Message("possible separate " .. tostring(committed_draw))
          Debug.Message("target relates " .. tostring(Duel.GetFirstTarget():IsRelateToEffect(e)))
        end)
        c:RegisterEffect(e)
      end
      `,
      "operation-info.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("operation info true/8/1/1/0/0");
    expect(host.messages).toContain("possible operation info true/65536/0/0/1/2");
    expect(host.messages).toContain("possible separate false");
    expect(host.messages).toContain("target relates true");
  });

  it("lets Lua effects seed target cards without selecting", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Manual Target Source", kind: "monster" },
      { code: "200", name: "Manual Target A", kind: "monster" },
      { code: "300", name: "Manual Target B", kind: "monster" },
    ];
    const session = createDuel({ seed: 48, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
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
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          local g=Duel.GetMatchingGroup(function(tc) return tc:IsCode(200) or tc:IsCode(300) end, tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(g)
          Debug.Message("manual target set " .. Duel.GetTargetCards():GetCount())
          local replacement=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(replacement)
          Debug.Message("manual target replaced " .. Duel.GetTargetCards():GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
          Duel.ClearTargetCard()
          Debug.Message("manual target clear alias " .. Duel.GetTargetCards():GetCount() .. "/" .. tostring(Duel.GetFirstTarget()==nil))
          Duel.SetTargetCard(g)
          Duel.SetTargetCard(nil)
          Debug.Message("manual target cleared " .. Duel.GetTargetCards():GetCount() .. "/" .. tostring(Duel.GetFirstTarget()==nil))
          Duel.SetTargetCard(g)
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local tg=Duel.GetTargetCards()
          Debug.Message("manual target cards " .. tg:GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "manual-target-card.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("manual target set 2");
    expect(host.messages).toContain("manual target replaced 1/300");
    expect(host.messages).toContain("manual target clear alias 0/true");
    expect(host.messages).toContain("manual target cleared 0/true");
    expect(host.messages.join("\n")).toContain("manual target cards 2/");
  });

  it("lets Lua quick effects inspect pending chain info", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Source", kind: "monster", alias: "101", level: 4, attack: 1800, defense: 1200, race: 0x2, attribute: 0x20 },
      { code: "200", name: "Chain Target", kind: "monster" },
      { code: "400", name: "Chain Quick", kind: "monster" },
    ];
    const session = createDuel({ seed: 24, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "200"] },
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
          local g=Duel.SelectTarget(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), 0, 0)
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          local te,tp,loc,tc,tg=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_EFFECT, CHAININFO_TRIGGERING_PLAYER, CHAININFO_TRIGGERING_LOCATION, CHAININFO_TRIGGERING_CARD, CHAININFO_TARGET_CARDS)
          local ok,handler=pcall(function() return te:GetHandler() end)
          Debug.Message("handler ok " .. tostring(ok) .. "/" .. tostring(handler ~= nil))
          if not ok then return false end
          Debug.Message("chain solving window " .. tostring(Duel.IsChainSolving()))
          Debug.Message("chain info " .. tp .. "/" .. loc .. "/" .. tc:GetCode() .. "/" .. tg:GetCount() .. "/" .. handler:GetCode())
          Debug.Message("chain count player " .. Duel.GetChainCount() .. "/" .. Duel.GetChainPlayer(1))
          local pos,code,code2,level,rank,attr,race,atk,def=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_POSITION, CHAININFO_TRIGGERING_CODE, CHAININFO_TRIGGERING_CODE2, CHAININFO_TRIGGERING_LEVEL, CHAININFO_TRIGGERING_RANK, CHAININFO_TRIGGERING_ATTRIBUTE, CHAININFO_TRIGGERING_RACE, CHAININFO_TRIGGERING_ATTACK, CHAININFO_TRIGGERING_DEFENSE)
          Debug.Message("chain stats " .. pos .. "/" .. code .. "/" .. code2 .. "/" .. level .. "/" .. rank .. "/" .. attr .. "/" .. race .. "/" .. atk .. "/" .. def)
          local chain_type,chain_exttype=Duel.GetChainInfo(1, CHAININFO_TYPE, CHAININFO_EXTTYPE)
          Debug.Message("chain type " .. chain_type .. "/" .. chain_exttype)
          local chain_id,disable_reason,disable_player=Duel.GetChainInfo(1, CHAININFO_CHAIN_ID, CHAININFO_DISABLE_REASON, CHAININFO_DISABLE_PLAYER)
          Debug.Message("chain id disable " .. tostring(chain_id>0) .. "/" .. disable_reason .. "/" .. disable_player)
          local mat=Duel.GetChainMaterial(1)
          Debug.Message("chain material " .. mat:GetCount() .. "/" .. mat:GetFirst():GetCode())
          Debug.Message("chain target fallback " .. Duel.GetTargetCards():GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
          Debug.Message("chain target checks " .. tostring(Duel.CheckChainTarget(1,tg:GetFirst())) .. "/" .. tostring(Duel.CheckChainTarget(1,e:GetHandler())))
          Debug.Message("chain unique " .. tostring(Duel.CheckChainUniqueness()))
          return tp==0 and tc:IsCode(100) and tg:GetCount()==1 and handler:IsCode(100)
        end)
        e:SetOperation(function(e,c)
          Debug.Message("quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-info.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok).toBe(true);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyResponse(session, quickAction!);
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    expect(host.messages).toContain("chain solving window false");
    expect(host.messages).toContain("chain info 0/2/100/1/100");
    expect(host.messages).toContain("chain count player 1/0");
    expect(host.messages).toContain("chain stats 0/100/101/4/0/32/2/1800/1200");
    expect(host.messages).toContain("chain type 64/1");
    expect(host.messages).toContain("chain id disable true/0/0");
    expect(host.messages).toContain("chain material 1/200");
    expect(host.messages).toContain("chain target fallback 1/200");
    expect(host.messages).toContain("chain target checks true/false");
    expect(host.messages).toContain("chain unique true");
    expect(host.messages).toContain("quick resolved");
    expect(host.messages).toContain("source resolved");
  });

  it("lets Lua effects block immediate chain responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Limit Source", kind: "monster" },
      { code: "400", name: "Blocked Quick", kind: "monster" },
    ];
    const session = createDuel({ seed: 52, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
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
          Duel.SetChainLimit(aux.FALSE)
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("limit source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,c)
          Debug.Message("blocked quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-limit.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    expect(host.messages).toContain("limit source resolved");
    expect(host.messages).not.toContain("blocked quick resolved");
  });

  it("keeps Lua chain limits until the chain resolves", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Persistent Limit Source", kind: "monster" },
      { code: "400", name: "Allowed Quick", kind: "monster" },
      { code: "500", name: "Blocked Chain Back", kind: "monster" },
    ];
    const session = createDuel({ seed: 53, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400"] },
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
          Duel.SetChainLimitTillChainEnd(function(te,rp,tp) return rp==1 end)
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("persistent source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("allowed quick resolved") end)
        c:RegisterEffect(e)
      end
      c500={}
      function c500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("chain back resolved") end)
        c:RegisterEffect(e)
      end
      `,
      "chain-limit-persistent.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    const allowed = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(allowed).toBeDefined();
    expect(applyResponse(session, allowed!).ok).toBe(true);
    expect(host.messages).toContain("allowed quick resolved");
    expect(host.messages).toContain("persistent source resolved");
    expect(host.messages).not.toContain("chain back resolved");
  });

  it("detects duplicate card codes in the current Lua chain", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Duplicate Chain Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 51, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_IGNITION)
        e1:SetRange(LOCATION_HAND)
        e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("duplicate source resolved")
        end)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_QUICK_O)
        e2:SetRange(LOCATION_HAND)
        e2:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e2:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("duplicate chain unique " .. tostring(Duel.CheckChainUniqueness()))
        end)
        c:RegisterEffect(e2)
      end
      `,
      "duplicate-chain.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    applyResponse(session, sourceAction!);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyResponse(session, quickAction!);
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    expect(host.messages).toContain("duplicate chain unique false");
    expect(host.messages).toContain("duplicate source resolved");
  });

  it("lets Lua effects carry target player and parameter metadata", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Target Metadata Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 50, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
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
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetTargetPlayer(1-tp)
          Duel.SetTargetParam(700)
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("target metadata solving " .. tostring(Duel.IsChainSolving()))
          Debug.Message("target metadata chain player " .. Duel.GetChainPlayer(0))
          local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
          Debug.Message("target metadata " .. p .. "/" .. d)
          Duel.ChangeTargetPlayer(0,tp)
          Duel.ChangeTargetParam(0,900)
          local p2,d2=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
          Debug.Message("target metadata changed " .. p2 .. "/" .. d2)
        end)
        c:RegisterEffect(e)
      end
      `,
      "target-metadata.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyResponse(session, action!);
    expect(host.messages).toContain("target metadata solving true");
    expect(host.messages).toContain("target metadata chain player 0");
    expect(host.messages).toContain("target metadata 1/700");
    expect(host.messages).toContain("target metadata changed 0/900");
  });

  it("lets Lua quick effects negate pending chain links", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negated Source", kind: "monster" },
      { code: "400", name: "Negating Quick", kind: "monster" },
    ];
    const session = createDuel({ seed: 25, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
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
        e:SetOperation(function(e,c)
          Debug.Message("source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.GetCurrentChain()>0 and Duel.IsChainNegatable(1) and Duel.IsChainDisablable(1)
        end)
        e:SetOperation(function(e,c)
          Debug.Message("negatable " .. tostring(Duel.IsChainNegatable(1)))
          Debug.Message("disablable " .. tostring(Duel.IsChainDisablable(1)))
          local before_reason,before_player=Duel.GetChainInfo(1, CHAININFO_DISABLE_REASON, CHAININFO_DISABLE_PLAYER)
          Debug.Message("disable before " .. before_reason .. "/" .. before_player)
          Debug.Message("negated " .. tostring(Duel.NegateEffect(1)))
          Debug.Message("disablable after " .. tostring(Duel.IsChainDisablable(1)))
          local after_reason,after_player=Duel.GetChainInfo(1, CHAININFO_DISABLE_REASON, CHAININFO_DISABLE_PLAYER)
          Debug.Message("disable after " .. after_reason .. "/" .. after_player)
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-negate.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    expect(applyResponse(session, quickAction!).ok).toBe(true);
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });

    expect(host.messages).toContain("negatable true");
    expect(host.messages).toContain("disablable true");
    expect(host.messages).toContain("disable before 0/0");
    expect(host.messages).toContain("negated true");
    expect(host.messages).toContain("disablable after false");
    expect(host.messages).toContain("disable after 64/1");
    expect(host.messages).not.toContain("source resolved");
    expect(session.state.log.some((entry) => entry.action === "chainNegated")).toBe(true);
  });

  it("passes upstream-style Lua callback arguments to trigger effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summoned Event", kind: "monster" },
      { code: "400", name: "Argument Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 26, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          local ec=eg:GetFirst()
          Debug.Message("condition args " .. tp .. "/" .. eg:GetCount() .. "/" .. ep .. "/" .. ev .. "/" .. tostring(re==nil) .. "/" .. r .. "/" .. rp .. "/" .. ec:GetCode())
          return tp==1 and eg:GetCount()==1 and ep==0 and ec:IsCode(100)
        end)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp)
          local handler=e:GetHandler()
          Debug.Message("target args " .. tp .. "/" .. handler:GetCode() .. "/" .. eg:GetFirst():GetCode())
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("operation args " .. tp .. "/" .. eg:GetFirst():GetCode() .. "/" .. tostring(re==nil))
          local ceg,cep,cev,cre,cr,crp=Duel.GetChainEvent(0)
          Debug.Message("chain event " .. ceg:GetCount() .. "/" .. cep .. "/" .. cev .. "/" .. tostring(cre==nil) .. "/" .. cr .. "/" .. crp .. "/" .. ceg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "callback-args.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon");
    expect(normal).toBeDefined();
    expect(applyResponse(session, normal!).ok).toBe(true);
    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);

    expect(host.messages).toContain("condition args 1/1/0/0/true/16/0/100");
    expect(host.messages).toContain("target args 1/400/100");
    expect(host.messages).toContain("operation args 1/100/true");
    expect(host.messages).toContain("chain event 1/0/0/true/16/0/100");
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
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag count " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag count " .. c:GetFlagEffect(902))
          Debug.Message("duel flag reset " .. Duel.ResetFlagEffect(0, 901))
          Debug.Message("card flag reset " .. c:ResetFlagEffect(902))
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
    expect(host.messages).toContain("duel flag count 1");
    expect(host.messages).toContain("card flag count 1");
    expect(host.messages).toContain("duel flag reset 1");
    expect(host.messages).toContain("card flag reset 1");
    expect(host.messages).toContain("duel flag after 0");
    expect(host.messages).toContain("card flag after 0");
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("provides common aux compatibility helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Aux A", kind: "monster" },
      { code: "200", name: "Aux B", kind: "monster" },
    ];
    const session = createDuel({ seed: 18, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_stringid = aux.Stringid(100, 2)
      Debug.Message("true count " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      Debug.Message("false count " .. Duel.GetMatchingGroupCount(aux.FALSE, 0, LOCATION_HAND, 0, nil))
      local wrapped = aux.NecroValleyFilter(aux.FilterBoolFunction(Card.IsCode, 100))
      Debug.Message("wrapped count " .. Duel.GetMatchingGroupCount(wrapped, 0, LOCATION_HAND, 0, nil))
      Debug.Message("target exists " .. tostring(Duel.IsExistingTarget(aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, nil)))
      Debug.Message("target count " .. Duel.GetTargetCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      `,
      "aux-helpers.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_stringid")).toBe(1602);
    expect(host.messages).toContain("true count 2");
    expect(host.messages).toContain("false count 0");
    expect(host.messages).toContain("wrapped count 1");
    expect(host.messages).toContain("target exists true");
    expect(host.messages).toContain("target count 2");
  });

  it("provides deterministic Lua option prompt helpers", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Prompt Source", kind: "monster" }];
    const session = createDuel({ seed: 30, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local option=Duel.SelectOption(0, 101, 102, 103)
      local yes=Duel.SelectYesNo(0, 201)
      local number=Duel.AnnounceNumber(0, 4, 7, 9)
      local card=Duel.AnnounceCard(0, 100, 200)
      local kind=Duel.AnnounceType(0, TYPE_MONSTER, TYPE_SPELL)
      local race=Duel.AnnounceRace(0, RACE_WARRIOR, RACE_SPELLCASTER)
      local attribute=Duel.AnnounceAttribute(0, ATTRIBUTE_LIGHT, ATTRIBUTE_DARK)
      local disabled=Duel.SelectDisableField(0, 1, LOCATION_MZONE, 0, 0)
      local selected=Duel.SelectField(0, 2, LOCATION_SZONE, LOCATION_MZONE, 0)
      Debug.Message("prompt option " .. option .. "/" .. tostring(yes))
      Debug.Message("prompt announce " .. number .. "/" .. card .. "/" .. kind .. "/" .. race .. "/" .. attribute)
      Debug.Message("prompt zones " .. disabled .. "/" .. selected .. "/" .. ZONES_MMZ .. "/" .. ZONES_EMZ)
      `,
      "prompt-helpers.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("prompt option 0/true");
    expect(host.messages).toContain("prompt announce 4/100/1/1/16");
    expect(host.messages).toContain("prompt zones 1/768/31/96");
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
    const cards: DuelCardData[] = [{ code: "100", name: "State Probe", kind: "monster", typeFlags: 0x21, attack: 1700, defense: 1300, level: 4, race: 0x2, attribute: 0x20 }];
    const session = createDuel({ seed: 20, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
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
      Debug.Message("relation checks " .. tostring(c:IsOnField()) .. "/" .. tostring(c:IsMonster()) .. "/" .. tostring(c:IsSpell()) .. "/" .. tostring(c:IsTrap()) .. "/" .. tostring(c:IsCanBeEffectTarget(nil)))
      Debug.Message("activity counts " .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_FLIPSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_ATTACK))
      Debug.Message("used summon legality " .. tostring(Duel.IsPlayerCanSummon(0, c)) .. "/" .. tostring(Duel.IsPlayerCanMSet(0, c)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, c)))
      Duel.SendtoGrave(c, REASON_EFFECT)
      local g = Duel.GetFieldCard(0, LOCATION_GRAVE, 0)
      Debug.Message("previous state " .. g:GetPreviousLocation() .. "/" .. g:GetPreviousControler() .. "/" .. g:GetPreviousSequence() .. "/" .. g:GetPreviousPosition())
      Debug.Message("previous position " .. tostring(g:IsPreviousPosition(POS_FACEUP_ATTACK)))
      Debug.Message("grave relation " .. tostring(g:IsOnField()) .. "/" .. tostring(g:IsMonster()))
      `,
      "card-state.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("card state 0/true/0/4/0/1");
    expect(host.messages).toContain("original meta 100/33/4/2/32");
    expect(host.messages).toContain("base stats 1700/1300");
    expect(host.messages).toContain("position checks true/true");
    expect(host.messages).toContain("relation checks true/true/false/false/true");
    expect(host.messages).toContain("activity counts 1/1/0/0/0");
    expect(host.messages).toContain("used summon legality false/false/false");
    expect(host.messages).toContain("previous state 4/0/0/1");
    expect(host.messages).toContain("previous position true");
    expect(host.messages).toContain("grave relation false/true");
  });

  it("executes smoke-test Lua scripts with EDOPro-style globals", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_player = Duel.GetTurnPlayer()
      observed_turn = Duel.GetTurnCount()
      observed_phase = Duel.GetCurrentPhase()
      observed_turn_player = tostring(Duel.IsTurnPlayer(0))
      observed_not_turn_player = tostring(Duel.IsTurnPlayer(1))
      observed_main_phase = tostring(Duel.IsMainPhase())
      observed_battle_phase = tostring(Duel.IsBattlePhase())
      observed_damage_step = tostring(Duel.IsDamageStep())
      observed_damage_calculated = tostring(Duel.IsDamageCalculated())
      observed_normal_activity = Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON)
      observed_summon_activity = Duel.GetActivityCount(0, ACTIVITY_SUMMON)
      observed_attack_activity = Duel.GetActivityCount(0, ACTIVITY_ATTACK)
      local hand = Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      observed_can_summon = tostring(Duel.IsPlayerCanSummon(0, hand))
      observed_can_mset = tostring(Duel.IsPlayerCanMSet(0, hand))
      observed_can_special = tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, hand))
      observed_bad_special_position = tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEDOWN_ATTACK, 0, hand))
      Debug.Message("lua host online")
      `,
      "smoke.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_player")).toBe(0);
    expect(host.getGlobalNumber("observed_turn")).toBe(1);
    expect(host.getGlobalNumber("observed_phase")).toBe(0x4);
    expect(host.getGlobalString("observed_turn_player")).toBe("true");
    expect(host.getGlobalString("observed_not_turn_player")).toBe("false");
    expect(host.getGlobalString("observed_main_phase")).toBe("true");
    expect(host.getGlobalString("observed_battle_phase")).toBe("false");
    expect(host.getGlobalString("observed_damage_step")).toBe("false");
    expect(host.getGlobalString("observed_damage_calculated")).toBe("false");
    expect(host.getGlobalNumber("observed_normal_activity")).toBe(0);
    expect(host.getGlobalNumber("observed_summon_activity")).toBe(0);
    expect(host.getGlobalNumber("observed_attack_activity")).toBe(0);
    expect(host.getGlobalString("observed_can_summon")).toBe("true");
    expect(host.getGlobalString("observed_can_mset")).toBe("true");
    expect(host.getGlobalString("observed_can_special")).toBe("true");
    expect(host.getGlobalString("observed_bad_special_position")).toBe("false");
    expect(host.messages).toContain("lua host online");
  });
});
